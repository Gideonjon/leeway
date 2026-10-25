import { planPayout } from "@leeway/core";
import type { WorkerContext } from "./context.js";

const MEMO = "Leeway cashback. Room to move.";

/** Pays every eligible cashback balance in one shielded transaction, inside the daily cap. */
export async function tickPayouts(ctx: WorkerContext) {
  const now = new Date();
  const entries = await ctx.db.pendingCashback(now);
  if (entries.length === 0) return;

  const paidLast24hZat = await ctx.db.cashbackPaidSince(new Date(now.getTime() - 86_400_000));
  const plan = planPayout(entries, {
    now,
    minZat: ctx.cfg.cashbackMinZat,
    dailyCapZat: ctx.cfg.cashbackDailyCapZat,
    paidLast24hZat,
  });
  if (plan.lines.length === 0) return;

  const txid = await ctx.wallet.send(plan.lines.map((l) => ({ address: l.address, zat: l.zat, memo: MEMO })));
  await ctx.db.recordPayout(txid, plan.lines);
  ctx.log("payouts", "paid", {
    recipients: plan.lines.length,
    totalZat: plan.totalZat.toString(),
    deferredCap: plan.deferred.filter((d) => d.reason === "daily_cap").length,
  });
}
