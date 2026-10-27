import {
  buildQuoteRequest,
  drawReleaseAt,
  leg2AmountZat,
  nextAction,
  purgedFields,
  ZcashSendFailed,
  ZEC_ASSET_ID,
  type GhostTransfer,
  type SwapStatus,
} from "@leeway/core";
import type { WorkerContext } from "./context.js";

/** Advances every live Ghost Send by at most one step per tick. */
export async function tickGhosts(ctx: WorkerContext) {
  const ghosts = await ctx.db.workableGhosts();
  for (const g of ghosts) {
    if (g.leg1DepositAddress?.startsWith("testnet_")) continue;
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

/** Stop a transfer for a human. Nothing further happens to it automatically, and it is not purged. */
async function review(ctx: WorkerContext, g: GhostTransfer, reason: string) {
  await ctx.db.updateGhost(g.id, { needsReview: true, error: reason });
  ctx.log("ghost", "NEEDS REVIEW", { code: g.code, state: g.state, reason });
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
        if (received <= cfg.zecFeeReserveZat) {
          await review(ctx, g, `Leg one delivered ${received} zat, too little to cover network fees.`);
          return;
        }
        await db.updateGhost(g.id, { state: "shielding", receivedZat: received, error: null });
        ctx.log("ghost", "leg1 received", { code: g.code, zat: received.toString() });
      } else {
        await db.updateGhost(g.id, { state: action.status === "REFUNDED" ? "refunded" : "failed", completedAt: now });
        ctx.log("ghost", "leg1 ended", { code: g.code, status: action.status });
      }
      return;
    }

    case "shield": {
      if (g.shieldStartedAt) {
        // A previous shield call began but its txid was never recorded (crash or timeout).
        const left = await wallet.transparentBalance(g.hopTransparentAddress!, 0);
        if (left === 0n) {
          // The funds left the hop address, so the shield went through. Proceed once it has had time to confirm.
          if (now.getTime() - g.shieldStartedAt.getTime() < 10 * 60_000) return;
          const releaseAt = drawReleaseAt(now, cfg.ghostMinDelaySec, cfg.ghostMaxDelaySec);
          await db.updateGhost(g.id, { state: "holding", shieldTxid: "recovered", releaseAt });
          ctx.log("ghost", "shield recovered after restart", { code: g.code });
          return;
        }
        // Funds still on the hop address: the earlier attempt never broadcast. Safe to try again.
      }
      await db.updateGhost(g.id, { shieldStartedAt: now });
      try {
        const txid = await wallet.shieldFrom(g.hopTransparentAddress!, g.receivedZat! - shieldFeeZat);
        await db.updateGhost(g.id, { shieldTxid: txid });
        ctx.log("ghost", "shielding", { code: g.code });
      } catch (e) {
        // A definite refusal can be retried next tick; anything else is resolved by the recovery check above.
        if (e instanceof ZcashSendFailed) await db.updateGhost(g.id, { shieldStartedAt: null, error: String(e).slice(0, 500) });
        throw e;
      }
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
        // We quoted leg two and may have sent, but never recorded it. Never risk paying twice.
        await review(ctx, g, "Leg two send state unknown after restart. Check the wallet for a send to the leg-two deposit address.");
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
            // A refund of leg two comes back to the hop address inside the Leeway wallet.
            refundTo: g.hopTransparentAddress!,
          },
          // The app fee is charged once, on leg one.
          { feeRecipient: cfg.feeRecipient, appFeeBps: 0, slippageBps: cfg.slippageBps },
        ),
      );
      const deposit = quote.quote.depositAddress!;
      await db.insertSwap({ kind: "ghost_leg2", quote, parentId: g.id });
      await db.updateGhost(g.id, { leg2DepositAddress: deposit });

      try {
        const txid = await wallet.send([{ address: deposit, zat: amount }]);
        await db.updateGhost(g.id, { leg2Txid: txid, state: "leg2_pending", error: null });
        await ctx.oneclick.submitDeposit(txid, deposit).catch(() => undefined);
        ctx.log("ghost", "leg2 sent", { code: g.code });
      } catch (e) {
        if (e instanceof ZcashSendFailed) {
          // Nothing left the wallet. Go back to holding and try again with a fresh quote shortly.
          await db.updateGhost(g.id, { state: "holding", leg2DepositAddress: null, releaseAt: new Date(now.getTime() + 5 * 60_000), error: String(e).slice(0, 500) });
          ctx.log("ghost", "leg2 refused by wallet, will retry", { code: g.code });
        } else {
          await review(ctx, g, `Leg two send outcome unknown: ${String(e).slice(0, 300)}`);
        }
      }
      return;
    }

    case "purge": {
      await db.updateGhost(g.id, { ...purgedFields(), purgedAt: now });
      await db.scrubGhostSwaps(g.id);
      ctx.log("ghost", "purged", { code: g.code });
      return;
    }
  }
}

/** Separate pass for leg-two settlement so `step` stays a single switch. */
export async function tickGhostLeg2(ctx: WorkerContext) {
  const ghosts = await ctx.db.workableGhosts();
  for (const g of ghosts) {
    if (g.state !== "leg2_pending") continue;
    const status = await legStatus(ctx, g.leg2DepositAddress);
    if (status === "SUCCESS") {
      await ctx.db.updateGhost(g.id, { state: "completed", completedAt: new Date(), error: null });
      ctx.log("ghost", "completed", { code: g.code });
    } else if (status === "REFUNDED" || status === "FAILED") {
      // The ZEC is back on the hop address. A human decides whether to retry or return it.
      await review(ctx, g, `Leg two ${status.toLowerCase()}: ZEC returned to the hop address.`);
    }
  }
}
