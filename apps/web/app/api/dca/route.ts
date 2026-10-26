import { isShieldedZcashAddress, leewayDcaAbi, zecRecipientHash } from "@leeway/core";
import { createPublicClient, decodeEventLog, http, isAddress, isHash } from "viem";
import { base } from "viem/chains";
import { errorMessage, fail, guard, json, screen, services } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Plans owned by a Base address. */
export async function GET(req: Request) {
  const blocked = await guard(req, "dca-list", { perMin: 60 });
  if (blocked) return blocked;
  const owner = new URL(req.url).searchParams.get("owner") ?? "";
  if (!isAddress(owner)) return fail("Connect a wallet to see your plans.");
  // Never return the Zcash address: anyone can query any EVM address, and pairing the two
  // would publish the very link the user is hiding. The plan's on-chain data is public anyway.
  const plans = await services().db.dcaPlansByOwner(owner);
  return json(plans.map(({ zecAddress: _hidden, ...p }) => p));
}

/**
 * Registers a plan after the user's createPlan transaction confirms.
 * The plan is read from the chain, never trusted from the request; the Zcash address
 * must hash to the commitment stored on-chain.
 */
export async function POST(req: Request) {
  const blocked = await guard(req, "dca", { perMin: 10 });
  if (blocked) return blocked;
  const { cfg, db } = services();
  if (!cfg.dcaContract) return fail("DCA isn't configured on this deployment yet.", 503);
  const body = (await req.json().catch(() => ({}))) as { txHash?: string; zecAddress?: string };
  if (!body.txHash || !isHash(body.txHash)) return fail("Missing transaction hash.");
  const zec = body.zecAddress?.trim() ?? "";
  if (!isShieldedZcashAddress(zec)) return fail("Use a shielded Zcash address (u1… or zs1…).");

  try {
    const pub = createPublicClient({ chain: base, transport: http(cfg.baseRpcUrl) });
    const receipt = await pub.waitForTransactionReceipt({ hash: body.txHash, timeout: 60_000 });
    let planId: bigint | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== cfg.dcaContract.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: leewayDcaAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "PlanCreated") planId = ev.args.planId;
      } catch {
        // not our event
      }
    }
    if (planId === null) return fail("That transaction didn't create a Leeway plan.");

    const p = await pub.readContract({ address: cfg.dcaContract, abi: leewayDcaAbi, functionName: "plans", args: [planId] });
    const [owner, , amountPerPeriod, interval, periodsTotal, , , active, hash] = p;
    if (hash !== zecRecipientHash(zec)) return fail("That Zcash address doesn't match the one committed in the plan.");
    const screened = await screen([owner]);
    if (screened) return screened;

    await db.upsertDcaPlan({
      planId: Number(planId),
      owner,
      zecAddress: zec,
      amountPerPeriod: amountPerPeriod.toString(),
      intervalSec: Number(interval),
      periodsTotal: Number(periodsTotal),
      active,
    });
    return json({ planId: Number(planId) });
  } catch (e) {
    return fail(errorMessage(e), 502);
  }
}
