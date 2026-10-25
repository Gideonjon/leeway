#!/usr/bin/env bash
# End-to-end: a Ghost Send through the real web API and worker, against mock 1Click + mock wallet.
# Needs: Postgres at $DATABASE_URL with db/schema.sql applied, mock-services.mjs running, web app on :3100.
set -euo pipefail
API=${API:-http://localhost:3100}
MOCK=http://localhost:4010
RPC=http://localhost:4020
USDC=nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near
SOL=nep141:sol.omft.near
CB="u1$(printf 'c%.0s' {1..120})"
worker() { (cd "$(dirname "$0")/../apps/worker" && npx tsx src/index.ts --once >/dev/null); }
rpc() { curl -s $RPC -d "{\"method\":\"$1\",\"params\":[]}" >/dev/null; }
state() { curl -s "$API/api/track/$CODE" | node -pe 'JSON.parse(require("fs").readFileSync(0)).state'; }

echo "1. dry quote"
curl -s -X POST $API/api/quote -H 'content-type: application/json' \
  -d "{\"originAsset\":\"$USDC\",\"destinationAsset\":\"$SOL\",\"amount\":\"250\",\"dry\":true}"; echo

echo "2. rejects a cashback address equal to the recipient"
curl -s -X POST $API/api/ghost -H 'content-type: application/json' \
  -d "{\"originAsset\":\"$USDC\",\"destinationAsset\":\"$SOL\",\"amount\":\"250\",\"recipient\":\"$CB\",\"refundTo\":\"0xabc\",\"cashbackAddress\":\"$CB\"}"; echo

echo "3. start ghost send"
START=$(curl -s -X POST $API/api/ghost -H 'content-type: application/json' \
  -d "{\"originAsset\":\"$USDC\",\"destinationAsset\":\"$SOL\",\"amount\":\"250\",\"recipient\":\"SoLRecipient111\",\"refundTo\":\"0x2527D02599Ba641c19FEa793cD0F167589a0f10D\",\"cashbackAddress\":\"$CB\"}")
echo "$START"
CODE=$(echo "$START" | node -pe 'JSON.parse(require("fs").readFileSync(0)).code')
DEP=$(echo "$START" | node -pe 'JSON.parse(require("fs").readFileSync(0)).depositAddress')
echo "   state: $(state)"

echo "4. user pays, leg one settles"
curl -s -X POST $MOCK/control/settle -d "{\"depositAddress\":\"$DEP\",\"status\":\"SUCCESS\"}" >/dev/null
worker; worker; echo "   state: $(state)"
worker; echo "   after shield call: $(state)"
rpc control_confirm_all; worker; echo "   state: $(state)"

echo "5. release hold early (test only) and send leg two"
psql "$DATABASE_URL" -qc "update ghost_transfers set release_at = now() - interval '1 second' where code = '$CODE'"
worker; echo "   state: $(state)"
LEG2=$(psql "$DATABASE_URL" -tAc "select leg2_deposit_address from ghost_transfers where code = '$CODE'")
curl -s -X POST $MOCK/control/settle -d "{\"depositAddress\":\"$LEG2\",\"status\":\"SUCCESS\"}" >/dev/null
worker; worker; echo "   state: $(state)"

echo "6. cashback accrued and paid"
worker
psql "$DATABASE_URL" -tAc "select source, zat, status from cashback_entries"
psql "$DATABASE_URL" -tAc "select recipients, total_zat from cashback_payouts"

echo "7. purge after window"
psql "$DATABASE_URL" -qc "update ghost_transfers set completed_at = now() - interval '2 days' where code = '$CODE'"
worker
psql "$DATABASE_URL" -tAc "select state, recipient is null, refund_to is null, hop_transparent_address is null, purged_at is not null from ghost_transfers where code = '$CODE'"

echo "8. wallet sends"
curl -s $RPC -d '{"method":"control_sends","params":[]}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).result.map(s=>s.policy+" "+s.amounts.map(a=>a.address.slice(0,6)+":"+a.amount+(a.memo?" memo":"")).join(",")).join("\n")'

echo "9. stats"
curl -s $API/api/stats; echo
