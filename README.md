# Leeway

**Room to move.** Private cross-chain payments, settled in shielded ZEC.

Leeway is one app with three features on one engine. Every flow follows the same path, source chain → shielded ZEC → destination, and a small fee on that path pays for cashback.

- **Ghost Send.** Pay someone on another chain. Funds go into shielded ZEC, wait a random 10–90 minutes in the Orchard pool, then come out as the asset the recipient asked for. The public chain can't tie the sender to the recipient.
- **Shielded DCA.** Buy ZEC on a schedule from USDC on Base. A non-custodial contract spends one period at a time straight from the user's wallet. Each buy lands at a shielded address.
- **Cashback.** 0.20% of every swap comes back in shielded ZEC, paid from the 0.50% app fee in one batched shielded transaction.
- **Swap.** Any-to-any through NEAR Intents 1Click, with cashback.

## Repo

| Path | What |
| --- | --- |
| `packages/core` | 1Click client, cashback math, Ghost Send state machine, Zcash wallet RPC, Postgres access. 26 unit tests. |
| `apps/web` | Next.js 15 app: Ghost Send, Swap, DCA and Cashback widgets with a live route panel, a token picker (1,788 token and 31 chain icons, self-hosted), EVM wallet connect with one-click deposit, an activity drawer, tracking, public numbers, API routes |
| `apps/worker` | Job loop: swap polling, Ghost Send legs, cashback accrual and payouts, DCA keeper |
| `contracts` | Foundry: `LeewayDCA.sol`, 11 tests including a fuzz test, Base deploy script |
| `db/schema.sql` | Postgres schema (idempotent) |
| `scripts/` | Mock 1Click + mock wallet, and an end-to-end Ghost Send script |

## Wallets

| Network | How it connects | What it does |
| --- | --- | --- |
| EVM | Every installed wallet via EIP-6963 (MetaMask, Rabby, Coinbase, OKX, Brave, Phantom EVM…), plus WalletConnect for mobile wallets by QR | Fills the refund address, pays the deposit in one tap (native or ERC-20), runs DCA |
| Solana | Every Wallet Standard wallet (Phantom, Solflare, Backpack…) | Fills the refund address, pays the deposit in one tap (SOL, SPL or Token-2022) |
| Zcash | ZIP-321 payment request link and QR: Noir, Zodl, Zingo, YWallet, Cake | Opens the user's wallet with address and amount filled in |
| BTC, LTC, DOGE | Standard payment URI QR | Opens the user's wallet |

One EVM and one Solana wallet can be connected at once, and both reconnect on return. Zcash wallets don't expose a connection API to websites today (Noir's Zcash WalletConnect work is in progress), so Zcash pays by payment request. `scripts/e2e-wallets.cjs` tests all of this with an injected EVM wallet on a local chain and an injected Solana wallet.

## Run it

```bash
cp .env.example .env            # fill in keys
npm install
npm run db:migrate              # applies db/schema.sql to $DATABASE_URL
npm run build
npm run start -w @leeway/web    # the app
npm run worker                  # the background jobs, in a second process
```

Tests:

```bash
npm test                        # core unit tests
cd contracts && forge test      # contract tests
```

End-to-end without real money (needs Postgres): start `node scripts/mock-services.mjs`, point `ONECLICK_BASE_URL` at `http://localhost:4010` and `ZCASH_RPC_URL` at `http://localhost:4020`, run the web app on port 3100, then `./scripts/e2e-ghost.sh`.

## Going live

1. **1Click.** Get a partner API key at partners.near-intents.org. Create an `ANY_INPUT` quote to get a fee-collection address and set it as `LEEWAY_FEE_RECIPIENT`.
2. **Wallet.** Run Zallet (or zcashd) with an account for Leeway. Fund it with a little ZEC for network fees and the cashback float. Keep RPC private to the worker and web hosts.
3. **Postgres.** Any managed Postgres 14+. Run `npm run db:migrate`.
4. **Contract.** `cd contracts && KEEPER_ADDRESS=0x… forge script script/Deploy.s.sol --rpc-url base --broadcast --private-key $DEPLOYER_KEY`. Fund the keeper with a little ETH on Base. Set `LEEWAY_DCA_CONTRACT` and `KEEPER_PRIVATE_KEY`.
5. **Deploy.** Web on Vercel or any Node host; the worker as one always-on process (Railway, Fly, a VM). Run exactly one worker.

## How Ghost Send works

```
awaiting_deposit → (leg 1 settles, ZEC on a fresh t-address) → shielding → (shield tx confirms)
→ holding (random delay) → sending_leg2 → leg2_pending → completed → (24h) purged
```

- Leg 1 sends ZEC to a fresh transparent address in the Leeway wallet; the worker shields it into Orchard right away.
- Leg 2 quotes ZEC → destination asset and sends from the shielded pool to a fresh 1Click deposit address.
- If the worker restarts mid-send with a quoted but unrecorded leg 2, the transfer stops for manual review instead of risking a double payment.
- 24 hours after completion, the recipient, refund, hop and deposit addresses are erased.

## Privacy, stated honestly

- Ghost Send hides the link from public chain observers, not from Leeway during the send. Logs are minimal and the link is erased after 24 hours.
- Matching amounts in and out can still link the two sides. The UI tells users to vary amounts.
- A custodial hop that breaks on-chain links can look like a mixer to regulators. Sends are capped (`LEEWAY_GHOST_MAX_USD`). Get legal advice before scaling.
- DCA puts only `keccak256(zcashAddress)` on-chain. The keeper supplies the 1Click deposit address, so v1 trusts Leeway's keeper; the per-period cap limits exposure to one period.

## Before mainnet

- Audit `LeewayDCA.sol`.
- Confirm Zallet RPC method support for `z_getaddressforaccount` receiver types and `z_sendmany` privacy policies on your version; the wallet sits behind the `ShieldedWallet` interface if you need another backend.
- Confirm the 1Click status values and fee behaviour on a small real swap.
- Next.js is pinned to 15.5.27 (patched). Keep it updated.
