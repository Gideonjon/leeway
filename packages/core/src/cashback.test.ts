import { describe, expect, it } from "vitest";
import {
  cashbackUsdMicros,
  eligibleAtFor,
  planPayout,
  usdMicrosToZat,
  usdToMicros,
  type CashbackEntry,
} from "./cashback.js";

const now = new Date("2026-10-25T12:00:00Z");
const entry = (id: string, address: string, zat: bigint, over: Partial<CashbackEntry> = {}): CashbackEntry => ({
  id,
  source: "swap",
  sourceId: id,
  address,
  usdMicros: 0n,
  zat,
  eligibleAt: now,
  status: "pending",
  ...over,
});

describe("usd conversion", () => {
  it("parses USD strings without float error", () => {
    expect(usdToMicros("123.45")).toBe(123_450_000n);
    expect(usdToMicros("0.1")).toBe(100_000n);
    expect(usdToMicros("7")).toBe(7_000_000n);
    expect(usdToMicros("1.23456789")).toBe(1_234_567n);
  });

  it("0.2% of a $500 swap is $1", () => {
    expect(cashbackUsdMicros(usdToMicros("500"), 20)).toBe(1_000_000n);
  });

  it("converts dollars to zatoshis and rounds down", () => {
    // $1 at $1,000/ZEC = 0.001 ZEC = 100,000 zat
    expect(usdMicrosToZat(1_000_000n, 1000)).toBe(100_000n);
    // never overpays: $1 at $3/ZEC = 0.3333.. ZEC
    expect(usdMicrosToZat(1_000_000n, 3)).toBe(33_333_333n);
  });

  it("rejects a non-positive price", () => {
    expect(() => usdMicrosToZat(1n, 0)).toThrow();
  });
});

describe("eligibility", () => {
  it("swaps and ghost sends are payable now; DCA waits for the 1st of next month", () => {
    expect(eligibleAtFor("swap", now)).toEqual(now);
    expect(eligibleAtFor("ghost", now)).toEqual(now);
    expect(eligibleAtFor("dca", now).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(eligibleAtFor("dca", new Date("2026-12-15T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("planPayout", () => {
  const base = { now, minZat: 100_000n, dailyCapZat: 1_000_000n, paidLast24hZat: 0n };

  it("groups entries per address", () => {
    const plan = planPayout([entry("a", "u1alice", 60_000n), entry("b", "u1alice", 60_000n), entry("c", "u1bob", 200_000n)], base);
    expect(plan.lines).toHaveLength(2);
    const alice = plan.lines.find((l) => l.address === "u1alice")!;
    expect(alice.zat).toBe(120_000n);
    expect(alice.entryIds.sort()).toEqual(["a", "b"]);
    expect(plan.totalZat).toBe(320_000n);
  });

  it("holds back balances below the minimum", () => {
    const plan = planPayout([entry("a", "u1dust", 5_000n)], base);
    expect(plan.lines).toHaveLength(0);
    expect(plan.deferred).toEqual([{ address: "u1dust", zat: 5_000n, reason: "below_minimum" }]);
  });

  it("respects the rolling daily cap, paying smaller balances first", () => {
    const plan = planPayout(
      [entry("big", "u1big", 900_000n), entry("s1", "u1s1", 150_000n), entry("s2", "u1s2", 150_000n)],
      { ...base, paidLast24hZat: 500_000n },
    );
    expect(plan.lines.map((l) => l.address)).toEqual(["u1s1", "u1s2"]);
    expect(plan.totalZat).toBe(300_000n);
    expect(plan.deferred).toEqual([{ address: "u1big", zat: 900_000n, reason: "daily_cap" }]);
  });

  it("skips entries that aren't eligible yet or are already paid", () => {
    const later = new Date(now.getTime() + 1000);
    const plan = planPayout(
      [entry("a", "u1a", 500_000n, { eligibleAt: later }), entry("b", "u1b", 500_000n, { status: "paid" })],
      base,
    );
    expect(plan.lines).toHaveLength(0);
    expect(plan.deferred).toHaveLength(0);
  });

  it("never exceeds the cap even when it is exhausted", () => {
    const plan = planPayout([entry("a", "u1a", 200_000n)], { ...base, paidLast24hZat: 1_000_000n });
    expect(plan.totalZat).toBe(0n);
  });
});
