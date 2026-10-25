import { errorMessage, fail, json, services } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Tells 1Click about a deposit the user just sent from their wallet, so the swap starts sooner. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { txHash?: string; depositAddress?: string };
  if (!body.txHash || !body.depositAddress) return fail("Missing txHash or depositAddress.");
  const { db, oneclick } = services();
  // Only addresses Leeway created can be submitted.
  const known = await db.swapByDeposit(body.depositAddress).catch(() => null);
  if (!known) return fail("Unknown deposit address.", 404);
  try {
    await oneclick.submitDeposit(body.txHash, body.depositAddress);
    return json({ ok: true });
  } catch (e) {
    return fail(errorMessage(e), 502);
  }
}
