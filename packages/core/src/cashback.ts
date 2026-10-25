/**
 * Cashback math and payout planning. Pure functions: no I/O, fully unit-tested.
 *
 * Model: Leeway charges `appFeeBps` on every swap (collected by 1Click as an app fee).
 * Of that, `cashbackBps` of the swap's USD value goes back to the user in shielded ZEC.
 * Amounts are held as integers: USD in micro-dollars, ZEC in zatoshis.
 */

export type CashbackSource = "swap" | "ghost" | "dca";

export interface CashbackEntry {
  id: string;
  source: CashbackSource;
  sourceId: string;
  address: string;
  usdMicros: bigint;
  zat: bigint;
  /** Earliest time this entry may be paid (DCA entries wait for the monthly payout). */
  eligibleAt: Date;
  status: "pending" | "paid";
}

export const USD_MICROS = 1_000_000n;

/** USD decimal string (e.g. "123.45") → micro-dollars, without floating point. */
export function usdToMicros(usd: string | number): bigint {
  const s = typeof usd === "number" ? usd.toFixed(6) : usd.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid USD amount: ${usd}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * USD_MICROS + BigInt((frac + "000000").slice(0, 6));
}

/** Cashback owed on a swap of `swapUsdMicros`, rounded down to the micro-dollar. */
export function cashbackUsdMicros(swapUsdMicros: bigint, cashbackBps: number): bigint {
  if (cashbackBps < 0) throw new Error("cashbackBps must be >= 0");
  return (swapUsdMicros * BigInt(cashbackBps)) / 10_000n;
}

/** Converts micro-dollars to zatoshis at `zecUsd`, rounded down so we never overpay. */
export function usdMicrosToZat(usdMicros: bigint, zecUsd: number): bigint {
  if (!(zecUsd > 0)) throw new Error("ZEC price must be positive");
  // Price scaled to micro-dollars per ZEC as an integer.
  const priceMicros = BigInt(Math.round(zecUsd * 1_000_000));
  return (usdMicros * 100_000_000n) / priceMicros;
}

/** When a new entry becomes payable. Swaps and Ghost Sends: immediately. DCA: the 1st of next month (UTC). */
export function eligibleAtFor(source: CashbackSource, now: Date): Date {
  if (source !== "dca") return now;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface PayoutLine {
  address: string;
  zat: bigint;
  entryIds: string[];
}

export interface PayoutPlan {
  lines: PayoutLine[];
  totalZat: bigint;
  /** Addresses whose balance is owed but held back (below minimum or over today's cap). */
  deferred: { address: string; zat: bigint; reason: "below_minimum" | "daily_cap" }[];
}

/**
 * Groups payable entries by address and fits them under the rolling daily cap.
 * Smallest balances are paid first so more people get paid when the cap binds.
 */
export function planPayout(
  entries: CashbackEntry[],
  opts: { now: Date; minZat: bigint; dailyCapZat: bigint; paidLast24hZat: bigint; maxRecipients?: number },
): PayoutPlan {
  const byAddress = new Map<string, PayoutLine>();
  for (const e of entries) {
    if (e.status !== "pending" || e.eligibleAt > opts.now || e.zat <= 0n) continue;
    const line = byAddress.get(e.address) ?? { address: e.address, zat: 0n, entryIds: [] };
    line.zat += e.zat;
    line.entryIds.push(e.id);
    byAddress.set(e.address, line);
  }

  const lines = [...byAddress.values()].sort((a, b) => (a.zat < b.zat ? -1 : a.zat > b.zat ? 1 : 0));
  const maxRecipients = opts.maxRecipients ?? 50;
  let budget = opts.dailyCapZat - opts.paidLast24hZat;
  const plan: PayoutPlan = { lines: [], totalZat: 0n, deferred: [] };

  for (const line of lines) {
    if (line.zat < opts.minZat) {
      plan.deferred.push({ address: line.address, zat: line.zat, reason: "below_minimum" });
      continue;
    }
    if (line.zat > budget || plan.lines.length >= maxRecipients) {
      plan.deferred.push({ address: line.address, zat: line.zat, reason: "daily_cap" });
      continue;
    }
    plan.lines.push(line);
    plan.totalZat += line.zat;
    budget -= line.zat;
  }
  return plan;
}

/** Cashback rate for display: "0.20%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
