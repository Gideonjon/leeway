import { cashbackUsdMicros, eligibleAtFor, usdMicrosToZat, usdToMicros, type CashbackSource, type SwapKind } from "@leeway/core";
import type { WorkerContext } from "./context.js";

/** Polls 1Click for every open swap and records status changes. */
export async function tickSwaps(ctx: WorkerContext) {
  const open = await ctx.db.openSwaps(["swap", "dca", "ghost_leg1", "ghost_leg2"]);
  for (const s of open) {
    try {
      const st = await ctx.oneclick.status(s.depositAddress, s.depositMemo ?? undefined);
      if (st.status !== s.status) {
        await ctx.db.updateSwapStatus(s.id, st.status, st.swapDetails?.amountOut ?? null, st.swapDetails?.amountInUsd ?? null);
        ctx.log("swaps", "status", { id: s.id, kind: s.kind, from: s.status, to: st.status });
      }
    } catch (e) {
      ctx.log("swaps", "poll failed", { id: s.id, error: String(e) });
    }
  }
}

const SOURCE_FOR_KIND: Partial<Record<SwapKind, CashbackSource>> = {
  swap: "swap",
  dca: "dca",
  ghost_leg1: "ghost", // cashback is earned once per Ghost Send, on the leg that carries the user's value in
};

/** Writes a cashback entry for every settled swap that has a payout address. */
export async function tickCashbackAccrual(ctx: WorkerContext) {
  const settled = await ctx.db.swapsAwaitingCashback();
  if (settled.length === 0) return;
  const price = await ctx.zecUsd();
  const now = new Date();
  for (const s of settled) {
    const source = SOURCE_FOR_KIND[s.kind];
    if (!source || !s.cashbackAddress || !s.amountInUsd) {
      await ctx.db.markCashbackAccrued(s.id);
      continue;
    }
    const usdMicros = cashbackUsdMicros(usdToMicros(s.amountInUsd), ctx.cfg.cashbackBps);
    const zat = usdMicrosToZat(usdMicros, price);
    await ctx.db.insertCashback({
      source,
      sourceId: s.id,
      address: s.cashbackAddress,
      usdMicros,
      zat,
      eligibleAt: eligibleAtFor(source, now),
    });
    await ctx.db.markCashbackAccrued(s.id);
    ctx.log("cashback", "accrued", { swap: s.id, source, zat: zat.toString() });
  }
}
