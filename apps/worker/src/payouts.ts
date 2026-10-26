import { planPayout, ZcashSendFailed } from "@leeway/core";
import type { WorkerContext } from "./context.js";

const MEMO = "Leeway cashback. Room to move.";

/**
 * Pays every eligible cashback balance in one shielded transaction, inside the daily cap.
 * Entries are reserved in the database before the wallet is called, so a crash between
 * sending and recording can never cause a second payment: the payout stays "sending"
 * and shows up in the review queue instead.
 */
export async function tickPayouts(ctx: WorkerContext) {
  const stuck = await ctx.db.stuckPayouts();
  if (stuck.length) {
    ctx.log("payouts", "NEEDS REVIEW: payouts with unknown outcome, holding all payouts", { ids: stuck.map((s) => s.id) });
    return;
  }

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

  const payoutId = await ctx.db.reservePayout(plan.lines);
  try {
    const txid = await ctx.wallet.send(plan.lines.map((l) => ({ address: l.address, zat: l.zat, memo: MEMO })));
    await ctx.db.markPayoutSent(payoutId, txid);
    ctx.log("payouts", "paid", { recipients: plan.lines.length, totalZat: plan.totalZat.toString() });
  } catch (e) {
    if (e instanceof ZcashSendFailed) {
      await ctx.db.releasePayout(payoutId, String(e));
      ctx.log("payouts", "wallet refused payout, released for retry", { error: String(e) });
    } else {
      await ctx.db.flagPayout(payoutId, String(e));
      ctx.log("payouts", "NEEDS REVIEW: payout outcome unknown", { payoutId, error: String(e) });
    }
    throw e;
  }
}
