/**
 * Ghost Send state machine.
 *
 *   awaiting_deposit ──leg1 SUCCESS──▶ shielding ──shield tx confirmed──▶ holding
 *          │                                                              │ release_at reached
 *          │ leg1 REFUNDED/FAILED                                         ▼
 *          ▼                                                       sending_leg2 ──sent──▶ leg2_pending
 *       refunded / failed                                                                   │ leg2 SUCCESS
 *                                                                                           ▼
 *                                                                                       completed ──after purge window──▶ (linking data erased)
 *
 * Leg 1: source asset → ZEC, delivered to a fresh transparent address in the Leeway wallet.
 * The wallet immediately shields it into the Orchard pool. After a random hold, leg 2 sends
 * ZEC from the shielded pool to a fresh 1Click deposit address for the destination asset.
 *
 * `nextAction` is pure: the worker reads a transfer, asks what to do, does it, and saves.
 */

import type { SwapStatus } from "./oneclick.js";

export type GhostState =
  | "awaiting_deposit"
  | "shielding"
  | "holding"
  | "sending_leg2"
  | "leg2_pending"
  | "completed"
  | "refunded"
  | "failed";

export interface GhostTransfer {
  id: string;
  code: string;
  state: GhostState;
  originAsset: string;
  destinationAsset: string;
  /** Destination address on the destination chain. Erased after the purge window. */
  recipient: string | null;
  /** Sender's refund address on the origin chain. Erased after the purge window. */
  refundTo: string | null;
  cashbackAddress: string | null;
  leg1DepositAddress: string | null;
  hopTransparentAddress: string | null;
  /** ZEC received by the hop address, in zatoshis. */
  receivedZat: bigint | null;
  shieldTxid: string | null;
  releaseAt: Date | null;
  leg2DepositAddress: string | null;
  leg2Txid: string | null;
  amountInUsd: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  purgedAt: Date | null;
  /** Set just before the wallet shields leg-one funds; detects a crash mid-shield. */
  shieldStartedAt: Date | null;
  /** Stopped for a human to check the wallet before anything else happens. */
  needsReview: boolean;
}

export type GhostAction =
  | { kind: "poll_leg1" }
  | { kind: "leg1_settled"; status: Extract<SwapStatus, "SUCCESS" | "REFUNDED" | "FAILED"> }
  | { kind: "shield" }
  | { kind: "await_shield" }
  | { kind: "shield_confirmed" }
  | { kind: "wait"; until: Date }
  | { kind: "send_leg2" }
  | { kind: "poll_leg2" }
  | { kind: "purge" }
  | { kind: "none" };

export interface GhostContext {
  now: Date;
  /** Latest 1Click status for the active leg, if fetched. */
  legStatus?: SwapStatus;
  /** Whether the shielding transaction has confirmed. */
  shieldConfirmed?: boolean;
  purgeAfterSec: number;
}

export function nextAction(t: GhostTransfer, ctx: GhostContext): GhostAction {
  switch (t.state) {
    case "awaiting_deposit": {
      const s = ctx.legStatus;
      if (s === "SUCCESS" || s === "REFUNDED" || s === "FAILED") return { kind: "leg1_settled", status: s };
      return { kind: "poll_leg1" };
    }
    case "shielding":
      if (!t.shieldTxid) return { kind: "shield" };
      return ctx.shieldConfirmed ? { kind: "shield_confirmed" } : { kind: "await_shield" };
    case "holding":
      if (t.releaseAt && t.releaseAt > ctx.now) return { kind: "wait", until: t.releaseAt };
      return { kind: "send_leg2" };
    case "sending_leg2":
      // A crash between quoting and sending leaves us here; the worker resumes the send idempotently.
      return { kind: "send_leg2" };
    case "leg2_pending":
      return { kind: "poll_leg2" };
    case "completed":
    case "refunded":
    case "failed": {
      if (t.purgedAt) return { kind: "none" };
      const doneAt = t.completedAt ?? t.updatedAt;
      if (ctx.now.getTime() - doneAt.getTime() >= ctx.purgeAfterSec * 1000) return { kind: "purge" };
      return { kind: "none" };
    }
  }
}

/** Uniform random hold between min and max seconds. `rand` is injectable for tests. */
export function drawReleaseAt(now: Date, minSec: number, maxSec: number, rand: () => number = Math.random): Date {
  const span = Math.max(0, maxSec - minSec);
  const delay = minSec + Math.floor(rand() * (span + 1));
  return new Date(now.getTime() + delay * 1000);
}

/** Leg 2 sends what arrived minus the reserve for the wallet's own network fees. */
export function leg2AmountZat(receivedZat: bigint, feeReserveZat: bigint): bigint {
  const amt = receivedZat - feeReserveZat;
  if (amt <= 0n) throw new Error("received amount does not cover network fees");
  return amt;
}

/** The fields erased once a transfer has settled and the purge window has passed. */
export function purgedFields(): Pick<GhostTransfer, "recipient" | "refundTo" | "leg1DepositAddress" | "leg2DepositAddress" | "hopTransparentAddress"> {
  return { recipient: null, refundTo: null, leg1DepositAddress: null, leg2DepositAddress: null, hopTransparentAddress: null };
}

const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** Human-friendly tracking code, e.g. "lw-7kq2-m9xa". */
export function makeTrackingCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(8);
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `lw-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

export interface GhostValidationInput {
  recipient: string;
  refundTo: string;
  cashbackAddress?: string | null;
  amountUsd: number;
  maxUsd: number;
}

export function validateGhostRequest(i: GhostValidationInput): string | null {
  if (!i.recipient.trim()) return "Recipient address is required.";
  if (!i.refundTo.trim()) return "Refund address is required.";
  if (i.amountUsd > i.maxUsd) return `Ghost Send is capped at $${i.maxUsd} per transfer.`;
  if (i.cashbackAddress) {
    const cb = i.cashbackAddress.trim();
    if (cb === i.recipient.trim() || cb === i.refundTo.trim()) {
      return "Use a cashback address that differs from both sides of the transfer, or the two sides can be linked.";
    }
  }
  return null;
}
