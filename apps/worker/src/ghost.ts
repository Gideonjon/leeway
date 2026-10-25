import {
  buildQuoteRequest,
  drawReleaseAt,
  leg2AmountZat,
  nextAction,
  purgedFields,
  ZEC_ASSET_ID,
  type GhostTransfer,
  type SwapStatus,
} from "@leeway/core";
import type { WorkerContext } from "./context.js";

/** Advances every live Ghost Send by at most one step per tick. */
export async function tickGhosts(ctx: WorkerContext) {
  const ghosts = await ctx.db.workableGhosts();
  for (const g of ghosts) {
    try {
      await step(ctx, g);
    } catch (e) {
      ctx.log("ghost", "step failed", { code: g.code, state: g.state, error: String(e) });
      await ctx.db.updateGhost(g.id, { error: String(e).slice(0, 500) });
    }
  }
}

async function legStatus(ctx: WorkerContext, depositAddress: string | null): Promise<SwapStatus | undefined> {
  if (!depositAddress) return undefined;
  return (await ctx.db.swapByDeposit(depositAddress))?.status;
}

async function step(ctx: WorkerContext, g: GhostTransfer) {
  const now = new Date();
  const { cfg, db, wallet } = ctx;
  const shieldFeeZat = cfg.zecFeeReserveZat / 2n;

  const status =
    g.state === "awaiting_deposit"
      ? await legStatus(ctx, g.leg1DepositAddress)
      : g.state === "leg2_pending"
        ? await legStatus(ctx, g.leg2DepositAddress)
        : undefined;
  const shieldConfirmed = g.state === "shielding" && g.shieldTxid ? (await wallet.confirmations(g.shieldTxid)) >= 1 : undefined;

  const action = nextAction(g, { now, legStatus: status, shieldConfirmed, purgeAfterSec: cfg.ghostPurgeAfterSec });

  switch (action.kind) {
    case "poll_leg1":
    case "poll_leg2":
    case "await_shield":
    case "wait":
    case "none":
      return;

    case "leg1_settled": {
      if (action.status === "SUCCESS") {
        // 1Click reports success when it broadcasts; wait until the ZEC is confirmed on our hop address.
        const received = await wallet.transparentBalance(g.hopTransparentAddress!, 1);
        if (received === 0n) return;
        await db.updateGhost(g.id, { state: "shielding", receivedZat: received, error: null });
        ctx.log("ghost", "leg1 received", { code: g.code, zat: received.toString() });
      } else {
        await db.updateGhost(g.id, { state: action.status === "REFUNDED" ? "refunded" : "failed", completedAt: now });
        ctx.log("ghost", "leg1 ended", { code: g.code, status: action.status });
      }
      return;
    }

    case "shield": {
      const txid = await wallet.shieldFrom(g.hopTransparentAddress!, g.receivedZat! - shieldFeeZat);
      await db.updateGhost(g.id, { shieldTxid: txid });
      ctx.log("ghost", "shielding", { code: g.code });
      return;
    }

    case "shield_confirmed": {
      const releaseAt = drawReleaseAt(now, cfg.ghostMinDelaySec, cfg.ghostMaxDelaySec);
      await db.updateGhost(g.id, { state: "holding", releaseAt });
      ctx.log("ghost", "holding", { code: g.code, releaseAt: releaseAt.toISOString() });
      return;
    }

    case "send_leg2": {
      if (g.state === "sending_leg2" && g.leg2DepositAddress && !g.leg2Txid) {
        // We quoted leg 2 but crashed before recording a send. Never risk paying twice: stop for review.
        await db.updateGhost(g.id, {
          state: "failed",
          completedAt: now,
          error: "Leg 2 send state unknown after restart. Check the wallet for a send to the leg-2 deposit address before retrying.",
        });
        ctx.log("ghost", "needs manual review", { code: g.code });
        return;
      }
      await db.updateGhost(g.id, { state: "sending_leg2" });

      const amount = leg2AmountZat(g.receivedZat!, cfg.zecFeeReserveZat);
      const quote = await ctx.oneclick.quote(
        buildQuoteRequest(
          {
            originAsset: ZEC_ASSET_ID,
            destinationAsset: g.destinationAsset,
            amount: amount.toString(),
            recipient: g.recipient!,
            // A refund of leg 2 comes back to the hop address inside the Leeway wallet.
            refundTo: g.hopTransparentAddress!,
          },
          // The app fee is charged once, on leg 1.
          { feeRecipient: cfg.feeRecipient, appFeeBps: 0, slippageBps: cfg.slippageBps },
        ),
      );
      const deposit = quote.quote.depositAddress!;
      await db.insertSwap({ kind: "ghost_leg2", quote, parentId: null });
      await db.updateGhost(g.id, { leg2DepositAddress: deposit });

      const txid = await wallet.send([{ address: deposit, zat: amount }]);
      await db.updateGhost(g.id, { leg2Txid: txid, state: "leg2_pending" });
      await ctx.oneclick.submitDeposit(txid, deposit).catch(() => undefined);
      ctx.log("ghost", "leg2 sent", { code: g.code });
      return;
    }

    case "purge": {
      await db.updateGhost(g.id, { ...purgedFields(), purgedAt: now });
      ctx.log("ghost", "purged", { code: g.code });
      return;
    }
  }
}

/** Separate pass for leg-2 settlement so `step` stays a single switch. */
export async function tickGhostLeg2(ctx: WorkerContext) {
  const ghosts = await ctx.db.workableGhosts();
  for (const g of ghosts) {
    if (g.state !== "leg2_pending") continue;
    const status = await legStatus(ctx, g.leg2DepositAddress);
    if (status === "SUCCESS") {
      await ctx.db.updateGhost(g.id, { state: "completed", completedAt: new Date(), error: null });
      ctx.log("ghost", "completed", { code: g.code });
    } else if (status === "REFUNDED" || status === "FAILED") {
      await ctx.db.updateGhost(g.id, {
        state: "failed",
        completedAt: new Date(),
        error: `Leg 2 ${status.toLowerCase()}: the ZEC is back in the Leeway wallet. Contact support with your tracking code.`,
      });
      ctx.log("ghost", "leg2 ended", { code: g.code, status });
    }
  }
}
