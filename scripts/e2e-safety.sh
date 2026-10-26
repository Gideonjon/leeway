#!/usr/bin/env bash
# Proves the money-safety mechanisms: payouts never double-pay, unknown sends stop for review,
# only one worker runs, rate limits hold. Same setup as e2e-ghost.sh.
set -euo pipefail
API=${API:-http://localhost:3100}
MOCK=http://localhost:4010
RPC=http://localhost:4020
USDC=nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near
SOL=nep141:sol.omft.near
SOLADDR=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
CB="u1$(printf 'd%.0s' {1..120})"
W="$(cd "$(dirname "$0")/../apps/worker" && pwd)"
worker() { (cd "$W" && npx tsx src/index.ts --once 2>&1); }
q() { psql "$DATABASE_URL" -tAc "$1"; }
rpc() { curl -s $RPC -d "{\"method\":\"$1\",\"params\":[$2]}" >/dev/null; }
pass() { echo "  PASS $1"; }
fail() { echo "  FAIL $1"; exit 1; }

q "truncate swaps, ghost_transfers, cashback_entries, cashback_payouts, rate_limits, worker_heartbeats cascade" >/dev/null

echo "1. Wallet refuses a payout: entries are released and paid on the next run, once"
q "insert into cashback_entries (source, source_id, address, usd_micros, zat, eligible_at) values ('swap', 'a1', '$CB', 1000000, 200000, now())" >/dev/null
rpc control_fail_next_send '"refuse"'
worker >/dev/null || true
[ "$(q "select status from cashback_payouts")" = "failed" ] && [ "$(q "select status from cashback_entries")" = "pending" ] && pass "refused payout released" || fail "refused payout"
worker >/dev/null
[ "$(q "select count(*) from cashback_payouts where status='sent'")" = "1" ] && [ "$(q "select status from cashback_entries")" = "paid" ] && pass "paid exactly once after retry" || fail "retry"

echo "2. Payout outcome unknown: stays reserved, all payouts pause, health flags it"
q "insert into cashback_entries (source, source_id, address, usd_micros, zat, eligible_at) values ('swap', 'a2', '$CB', 1000000, 300000, now())" >/dev/null
rpc control_fail_next_send '"unknown"'
worker >/dev/null || true
[ "$(q "select count(*) from cashback_payouts where status='unknown'")" = "1" ] && [ "$(q "select status from cashback_entries where source_id='a2'")" = "reserved" ] && pass "unknown payout held, not released" || fail "unknown payout"
q "insert into cashback_entries (source, source_id, address, usd_micros, zat, eligible_at) values ('swap', 'a3', '$CB', 1000000, 300000, now())" >/dev/null
worker >/dev/null
[ "$(q "select status from cashback_entries where source_id='a3'")" = "pending" ] && pass "new payouts pause until a human reconciles" || fail "pause"
curl -s $API/api/health | grep -q '"payouts":1' && pass "health reports the review" || fail "health"
q "update cashback_payouts set status='sent', txid='reconciled' where status='unknown'; update cashback_entries set status='paid' where status='reserved'" >/dev/null

echo "3. Leg two outcome unknown: the transfer stops for review and is never resent"
START=$(curl -s -X POST $API/api/ghost -H 'content-type: application/json' \
  -d "{\"originAsset\":\"$USDC\",\"destinationAsset\":\"$SOL\",\"amount\":\"100\",\"recipient\":\"$SOLADDR\",\"refundTo\":\"0x2527D02599Ba641c19FEa793cD0F167589a0f10D\"}")
CODE=$(echo "$START" | node -pe 'JSON.parse(require("fs").readFileSync(0)).code')
DEP=$(echo "$START" | node -pe 'JSON.parse(require("fs").readFileSync(0)).depositAddress')
curl -s -X POST $MOCK/control/settle -d "{\"depositAddress\":\"$DEP\",\"status\":\"SUCCESS\"}" >/dev/null
worker >/dev/null; worker >/dev/null; rpc control_confirm_all ""; worker >/dev/null
q "update ghost_transfers set release_at = now() - interval '1 second' where code = '$CODE'" >/dev/null
rpc control_fail_next_send '"unknown"'
worker >/dev/null || true
[ "$(q "select needs_review from ghost_transfers where code='$CODE'")" = "t" ] && pass "flagged for review" || fail "review flag"
SENDS_BEFORE=$(curl -s $RPC -d '{"method":"control_sends","params":[]}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).result.length')
worker >/dev/null; worker >/dev/null
SENDS_AFTER=$(curl -s $RPC -d '{"method":"control_sends","params":[]}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).result.length')
[ "$SENDS_BEFORE" = "$SENDS_AFTER" ] && pass "no further sends while under review" || fail "resend"
curl -s "$API/api/track/$CODE" | grep -q '"review":true' && pass "tracking page tells the user it's being checked" || fail "track review"

echo "4. Only one worker can move money"
(cd "$W" && npx tsx src/index.ts > /tmp/worker-a.log 2>&1 &)
sleep 6
OUT=$(worker)
pkill -f "tsx src/index.ts" 2>/dev/null || true
echo "$OUT" | grep -q "another worker holds the lock" && pass "second worker refused to start" || fail "lock: $OUT"

echo "5. Rate limits"
q "truncate rate_limits" >/dev/null
CODES=""
for i in 1 2 3 4 5 6 7; do
  CODES="$CODES $(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/ghost -H 'content-type: application/json' -d '{}')"
done
echo "   ghost endpoint responses: $CODES"
echo "$CODES" | grep -q "429" && pass "7th request in a minute is refused" || fail "rate limit"
BIG=$(head -c 20000 /dev/zero | tr '\0' 'a')
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/api/deposit -H 'content-type: application/json' -d "{\"x\":\"$BIG\"}")" = "413" ] && pass "oversized body refused" || fail "body cap"

echo "All safety checks passed."
