# LeewayDCA — Security Audit Brief & Internal Review

## 1. Scope

| File | Lines | Purpose |
| --- | --- | --- |
| [`contracts/src/LeewayDCA.sol`](./contracts/src/LeewayDCA.sol) | 189 | Non-custodial recurring USDC → shielded ZEC execution contract on Base |
| [`contracts/script/Deploy.s.sol`](./contracts/script/Deploy.s.sol) | 36 | Atomic deployment & handoff of `admin` role to a Safe multisig |
| [`contracts/test/LeewayDCA.t.sol`](./contracts/test/LeewayDCA.t.sol) | 178 | Unit & fuzz test suite (11 tests) |

* **Target chain:** Base Mainnet (`chainId: 8453`)
* **Solidity compiler:** `^0.8.24` (built-in overflow/underflow checks)
* **Initial allowed token:** Native Base USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)

---

## 2. Architecture & Trust Model

1. **Zero Custody:** `LeewayDCA` never holds user tokens. Users approve `LeewayDCA` to spend their ERC-20 token (`USDC`) and register a `Plan` via `createPlan(...)`.
2. **Off-Chain Privacy Preservation:** The user's shielded Zcash address (`u1...` or `zs1...`) is never written to the Base blockchain. Only `zecRecipientHash = keccak256(bytes(zcashAddress))` is stored on-chain in `Plan.zecRecipientHash` and emitted in `PlanCreated`. The off-chain API (`POST /api/dca`) verifies `keccak256(bytes(zecAddress)) == onChainPlan.zecRecipientHash` before storing the shielded address in Postgres.
3. **Bounded Keeper Authority:**
   * Only `keeper` can call `execute(uint256 planId, address depositAddress)`.
   * Because NEAR Intents 1Click generates a fresh EVM deposit address per swap quote, the contract cannot verify on-chain that `depositAddress` belongs to a 1Click quote for `zecRecipientHash`.
   * **Maximum Blast Radius of a Compromised Keeper:** Bounded strictly to **one `amountPerPeriod` per `interval`** (minimum `MIN_INTERVAL = 1 hours`) for active plans until `admin` calls `setPaused(true)` or `setKeeper(newKeeper)`, or the user calls `cancelPlan(planId)` / revokes ERC-20 allowance.
4. **No Catch-Up Drain After Outages:**
   * In `execute()`, `nextRunAt` is updated via:
     ```solidity
     uint64 planned = p.nextRunAt + p.interval;
     p.nextRunAt = planned > block.timestamp ? planned : uint64(block.timestamp) + p.interval;
     ```
   * If the keeper is offline for multiple intervals, it can only execute **once** upon recovery and must wait a full `p.interval` before the next execution (verified by `test_longOutageDoesNotAllowBackToBackRuns` and `testFuzz_neverPullsMoreThanOnePeriodPerInterval`).

---

## 3. Core Invariants

1. **Balance Invariant:** `IERC20(token).balanceOf(address(dca)) == 0` across all state transitions.
2. **Cadence Invariant:** For any `planId`, `execute()` cannot succeed more than once within any `(t, t + interval)` window.
3. **Cap Invariant:** If `periodsTotal > 0`, `execute()` can succeed at most `periodsTotal` times (`periodsDone <= periodsTotal`), deactivating (`active = false`) on the final period.
4. **Cancellation Invariant:** Once `active == false` (via owner `cancelPlan` or reaching `periodsTotal`), `active` can never become `true` again.
5. **Checks-Effects-Interactions (CEI):** In `execute()`, all state mutations (`p.periodsDone`, `p.nextRunAt`, `p.active`) occur **before** `_safeTransferFrom(...)`, preventing reentrancy even if an ERC-777 or hook-enabled token were ever allowlisted.

---

## 4. Finding & Hardening Checklist

| # | Area | Status | Notes |
| --- | --- | --- | --- |
| 1 | Reentrancy in `execute()` | **Safe** | Follows strict Checks-Effects-Interactions: `periodsDone`, `nextRunAt`, and `active` are written prior to `_safeTransferFrom`. |
| 2 | Non-standard ERC-20 return values | **Safe** | `_safeTransferFrom` checks `ok && (data.length == 0 \|\| abi.decode(data, (bool)))`. Note: `token` is restricted to `allowedToken[token]` (which ensures `token` has contract code). |
| 3 | Fee-on-transfer / rebasing tokens | **Admin Policy** | Only allowlist standard 1:1 ERC-20 stablecoins (Base native USDC). Do not allowlist fee-on-transfer tokens, as 1Click `EXACT_INPUT` quotes expect exact `amountPerPeriod` arrival at `depositAddress`. |
| 4 | Single-step `setAdmin(address)` | **Low / Operational** | `setAdmin` overwrites `admin` immediately (rejecting `address(0)`). During deployment, `Deploy.s.sol` calls `setAdmin(ADMIN_ADDRESS)` atomically in the same broadcast and asserts `dca.admin() == admin`. Subsequent admin changes from the Safe multisig should be double-checked before signing. |
| 5 | `setKeeper(address(0))` | **Informational** | `setKeeper` allows `address(0)`, which effectively disables execution without pausing `createPlan`. `setPaused(true)` is the standard circuit breaker. |
| 6 | Integer widths (`uint64 nextRunAt`, `uint32 periodsDone`) | **Safe** | `uint64` timestamps are valid for >500 billion years. `uint32 periodsDone` + `1` cannot overflow at `MIN_INTERVAL = 1 hours` (4e9 hours ≈ 489,000 years). |

---

## 5. Deployment & Verification Procedure

1. **Create Admin Multisig:** Create a Safe (e.g., 2-of-3 or 3-of-5) on Base Mainnet at [app.safe.global](https://app.safe.global) and copy its address as `ADMIN_ADDRESS`.
2. **Generate Keeper Account:** Generate a dedicated EOA for the worker (`KEEPER_ADDRESS` / `KEEPER_PRIVATE_KEY`) and fund it with ~0.005–0.02 ETH on Base.
3. **Run Foundry Tests:**
   ```bash
   cd contracts
   forge test -vvv
   ```
4. **Deploy & Verify on Base Mainnet:**
   ```bash
   cd contracts
   KEEPER_ADDRESS=0xYourKeeperAddress \
   ADMIN_ADDRESS=0xYourSafeMultisigAddress \
   forge script script/Deploy.s.sol \
     --rpc-url https://mainnet.base.org \
     --private-key $DEPLOYER_PRIVATE_KEY \
     --broadcast \
     --verify \
     --etherscan-api-key $BASESCAN_API_KEY
   ```
5. **Post-Deploy Checks:**
   * Confirm `dca.admin()` equals `ADMIN_ADDRESS` (Safe multisig).
   * Confirm `dca.keeper()` equals `KEEPER_ADDRESS`.
   * Confirm `dca.allowedToken(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)` is `true`.
   * Set `LEEWAY_DCA_CONTRACT=<deployed_address>` and `KEEPER_PRIVATE_KEY=<keeper_private_key>` in `.env`.
