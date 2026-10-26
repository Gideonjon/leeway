import { errorMessage, fail, guard, json, services } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Public status of a Ghost Send by tracking code, or of a swap by deposit address.
 * Never returns the recipient, refund address or hop address.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const blocked = await guard(req, "track", { perMin: 60 });
  if (blocked) return blocked;
  const { code } = await params;
  const { db } = services();
  try {
    if (/^lw-[2-9a-z]{4}-[2-9a-z]{4}$/.test(code)) {
      const g = await db.ghostByCode(code);
      if (!g) return fail("No transfer with that code. Check it and try again.", 404);
      return json({
        type: "ghost",
        code: g.code,
        state: g.state,
        depositAddress: g.state === "awaiting_deposit" ? g.leg1DepositAddress : null,
        amountInUsd: g.amountInUsd,
        releaseAt: g.releaseAt,
        createdAt: g.createdAt,
        completedAt: g.completedAt,
        purged: Boolean(g.purgedAt),
        review: g.needsReview,
        error: g.error,
      });
    }
    const s = await db.swapByDeposit(code);
    if (!s || s.kind !== "swap") return fail("Nothing found. Paste a tracking code (lw-…) or a swap deposit address.", 404);
    return json({
      type: "swap",
      status: s.status,
      amountIn: s.amountIn,
      amountInUsd: s.amountInUsd,
      amountOut: s.amountOut,
      createdAt: s.createdAt,
    });
  } catch (e) {
    return fail(errorMessage(e), 500);
  }
}
