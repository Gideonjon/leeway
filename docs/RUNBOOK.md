# Leeway runbook

How to launch Leeway on mainnet, watch it, and handle the cases where it deliberately stops and asks for a human.

## Launch checklist

Work top to bottom. Don't open Ghost Send to the public until every box above "Go live" is ticked.

### Accounts and keys
- [ ] 1Click partner API key from partners.near-intents.org → `ONECLICK_API_KEY`
- [ ] Fee collection: create an `ANY_INPUT` quote, set its deposit address as `LEEWAY_FEE_RECIPIENT`
- [ ] WalletConnect project id (cloud.reown.com) → `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (build-time)
- [ ] Paid Solana RPC (Helius, Triton, QuickNode) → `SOLANA_RPC_URL`
- [ ] Optional but recommended: Chainalysis Sanctions API key → `LEEWAY_SCREENING_API_KEY`
- [ ] Strong `POSTGRES_PASSWORD`, `ZCASH_RPC_USER`, `ZCASH_RPC_PASSWORD`; store them in a secret manager, not in the repo

### Zcash wallet
- [ ] Zebra fully synced on mainnet
- [ ] Zallet pinned to an exact version, connected to Zebra, RPC reachable only from the worker and web containers
- [ ] Worker starts without `WALLET INCOMPATIBLE` (it checks every RPC method Leeway needs)
- [ ] Wallet seed backed up offline, in two places
- [ ] Float funded: enough shielded ZEC for network fees, plus the cashback budget (`LEEWAY_CASHBACK_DAILY_CAP_ZAT` × days of runway)

### DCA contract (Base)
- [ ] Audit `contracts/src/LeewayDCA.sol` (small, but it moves user funds)
- [ ] Create a Safe multisig for admin
- [ ] Deploy: `KEEPER_ADDRESS=… ADMIN_ADDRESS=<safe> forge script script/Deploy.s.sol --rpc-url base --broadcast --verify`
- [ ] Keeper key funded with a little ETH on Base → `KEEPER_PRIVATE_KEY`, `LEEWAY_DCA_CONTRACT`

### Infrastructure
- [ ] `docker compose up -d --build` (Postgres, migrate, web, worker); TLS proxy in front of web
- [ ] Exactly one worker (extra replicas exit on start)
- [ ] Uptime monitor on `GET /api/health` (503 means look now), alert to a phone
- [ ] Log shipping from web and worker; alert on any line containing `NEEDS REVIEW`
- [ ] Daily Postgres backups, restore tested once

### Legal and limits
- [ ] Terms reviewed by counsel; operating entity and governing law added to `/terms`
- [ ] Ghost Send limits set conservatively for launch: `LEEWAY_GHOST_MAX_USD` (per send) and `LEEWAY_GHOST_DAILY_CAP_USD` (all sends, 24h)

### Dry run on mainnet
- [ ] One $5 Swap from an EVM wallet, one from a Solana wallet, one from ZEC via payment request
- [ ] One $10 Ghost Send end to end; confirm delivery, cashback accrual, and purge after 24h
- [ ] One DCA plan with a $5 buy; confirm the buy lands shielded; cancel it

### Go live

## Watching it

`GET /api/health` returns:

| Field | Healthy | If not |
| --- | --- | --- |
| `db` | `ok` | Postgres down: web refuses new transfers, worker retries |
| `routes` | `ok` | 1Click unreachable: quotes fail, nothing is lost |
| `worker` | `ok` | A job hasn't succeeded in 20 minutes. Check worker logs |
| `needsReview` | `{ghosts: 0, payouts: 0}` | Something stopped for a human. See below |

## When Leeway stops and asks for a human

Leeway never retries a send whose outcome it can't confirm. It stops, logs `NEEDS REVIEW`, and waits.

### A Ghost Send under review

```sql
select code, state, error, hop_transparent_address, leg2_deposit_address, leg2_txid, received_zat
from ghost_transfers where needs_review;
```

| `error` says | What happened | What to do |
| --- | --- | --- |
| Leg two send state unknown / outcome unknown | The wallet may or may not have sent leg two | Check the wallet history for a send to `leg2_deposit_address`. If it went out: set `leg2_txid`, `state = 'leg2_pending'`, `needs_review = false`. If not: set `state = 'holding'`, `leg2_deposit_address = null`, `release_at = now()`, `needs_review = false` |
| Leg two refunded / failed | 1Click returned the ZEC to the hop address | Either retry (as "not sent" above, after shielding the refund) or return the funds to the sender's refund address by hand |
| Too little to cover network fees | Leg one delivered dust | Return what arrived to the sender's refund address; mark `state = 'failed'` |

The user's tracking page shows "Paused for a manual check" while `needs_review` is true.

### A cashback payout under review

```sql
select id, status, error, total_zat, recipients, created_at from cashback_payouts where status in ('unknown', 'sending');
```

All payouts pause while one is unresolved. Look for the transaction in the wallet:

- **It went out:** `update cashback_payouts set status = 'sent', txid = '<txid>' where id = '…'; update cashback_entries set status = 'paid' where payout_id = '…';`
- **It didn't:** `update cashback_payouts set status = 'failed' where id = '…'; update cashback_entries set status = 'pending', payout_id = null where payout_id = '…';`

## Routine operations

- **Pause DCA:** the admin Safe calls `setPaused(true)` on `LeewayDCA`. Users' funds stay in their wallets.
- **Rotate the keeper:** generate a new key, admin calls `setKeeper(new)`, update `KEEPER_PRIVATE_KEY`, restart the worker.
- **Stop new Ghost Sends:** set `LEEWAY_GHOST_DAILY_CAP_USD=1` and restart web. Transfers in flight keep going.
- **Schema changes:** `db/schema.sql` is additive and idempotent; the `migrate` service applies it on every deploy.
- **Upgrade Zallet:** stop the worker first (it waits up to 60 seconds for in-flight sends), upgrade, start the worker, and confirm it doesn't log `WALLET INCOMPATIBLE`.
