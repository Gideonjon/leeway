import { describe, expect, it } from "vitest";
import {
  drawReleaseAt,
  leg2AmountZat,
  makeTrackingCode,
  nextAction,
  validateGhostRequest,
  type GhostTransfer,
} from "./ghost.js";

const now = new Date("2026-10-25T12:00:00Z");
const ctx = { now, purgeAfterSec: 86_400 };

const ghost = (over: Partial<GhostTransfer> = {}): GhostTransfer => ({
  id: "g1",
  code: "lw-abcd-efgh",
  state: "awaiting_deposit",
  originAsset: "o",
  destinationAsset: "d",
  recipient: "0xrecipient",
  refundTo: "0xrefund",
  cashbackAddress: null,
  leg1DepositAddress: "0xdeposit",
  hopTransparentAddress: "t1hop",
  receivedZat: null,
  shieldTxid: null,
  releaseAt: null,
  leg2DepositAddress: null,
  leg2Txid: null,
  amountInUsd: "100",
  error: null,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  purgedAt: null,
  shieldStartedAt: null,
  needsReview: false,
  ...over,
});

describe("nextAction", () => {
  it("polls leg 1 until it settles", () => {
    expect(nextAction(ghost(), ctx)).toEqual({ kind: "poll_leg1" });
    expect(nextAction(ghost(), { ...ctx, legStatus: "PROCESSING" })).toEqual({ kind: "poll_leg1" });
    expect(nextAction(ghost(), { ...ctx, legStatus: "SUCCESS" })).toEqual({ kind: "leg1_settled", status: "SUCCESS" });
    expect(nextAction(ghost(), { ...ctx, legStatus: "REFUNDED" })).toEqual({ kind: "leg1_settled", status: "REFUNDED" });
  });

  it("shields, waits for confirmation, then moves to holding", () => {
    expect(nextAction(ghost({ state: "shielding" }), ctx)).toEqual({ kind: "shield" });
    expect(nextAction(ghost({ state: "shielding", shieldTxid: "tx" }), ctx)).toEqual({ kind: "await_shield" });
    expect(nextAction(ghost({ state: "shielding", shieldTxid: "tx" }), { ...ctx, shieldConfirmed: true })).toEqual({
      kind: "shield_confirmed",
    });
  });

  it("holds until the release time, then sends leg 2", () => {
    const later = new Date(now.getTime() + 60_000);
    expect(nextAction(ghost({ state: "holding", releaseAt: later }), ctx)).toEqual({ kind: "wait", until: later });
    expect(nextAction(ghost({ state: "holding", releaseAt: now }), ctx)).toEqual({ kind: "send_leg2" });
  });

  it("resumes an interrupted leg-2 send", () => {
    expect(nextAction(ghost({ state: "sending_leg2" }), ctx)).toEqual({ kind: "send_leg2" });
  });

  it("purges linking data only after the window", () => {
    const done = ghost({ state: "completed", completedAt: now });
    expect(nextAction(done, ctx)).toEqual({ kind: "none" });
    expect(nextAction(done, { ...ctx, now: new Date(now.getTime() + 86_400_000) })).toEqual({ kind: "purge" });
    expect(nextAction(ghost({ state: "completed", completedAt: now, purgedAt: now }), { ...ctx, now: new Date(now.getTime() + 9e9) })).toEqual({
      kind: "none",
    });
  });
});

describe("helpers", () => {
  it("draws a release time inside the window", () => {
    expect(drawReleaseAt(now, 600, 5400, () => 0).getTime()).toBe(now.getTime() + 600_000);
    expect(drawReleaseAt(now, 600, 5400, () => 0.999999).getTime()).toBe(now.getTime() + 5_400_000);
  });

  it("keeps a fee reserve on leg 2", () => {
    expect(leg2AmountZat(1_000_000n, 30_000n)).toBe(970_000n);
    expect(() => leg2AmountZat(20_000n, 30_000n)).toThrow();
  });

  it("makes readable tracking codes", () => {
    const code = makeTrackingCode((n) => new Uint8Array(n).map((_, i) => i * 37));
    expect(code).toMatch(/^lw-[2-9a-z]{4}-[2-9a-z]{4}$/);
  });

  it("rejects a cashback address that would link the two sides", () => {
    const base = { recipient: "0xR", refundTo: "0xS", amountUsd: 100, maxUsd: 2000 };
    expect(validateGhostRequest({ ...base, cashbackAddress: "u1me" })).toBeNull();
    expect(validateGhostRequest({ ...base, cashbackAddress: "0xR" })).toMatch(/differs/);
    expect(validateGhostRequest({ ...base, amountUsd: 5000 })).toMatch(/capped/);
  });
});
