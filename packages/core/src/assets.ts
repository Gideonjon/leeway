import type { Token } from "./oneclick.js";

/** NEAR Intents asset id for native ZEC. */
export const ZEC_ASSET_ID = "nep141:zec.omft.near";
/** Native USDC on Base, as NEAR Intents sees it. */
export const BASE_USDC_ASSET_ID = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const ZAT_PER_ZEC = 100_000_000n;

export function findToken(tokens: Token[], assetId: string): Token | undefined {
  return tokens.find((t) => t.assetId === assetId);
}

export function zecPrice(tokens: Token[]): number {
  const t = findToken(tokens, ZEC_ASSET_ID);
  if (!t || !(t.price > 0)) throw new Error("ZEC price unavailable from 1Click tokens list");
  return t.price;
}

/** Decimal string → integer base units, without floating point. "1.5", 6 → "1500000". */
export function toBaseUnits(amount: string, decimals: number): string {
  const s = amount.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") throw new Error("Enter a number, like 25 or 0.5.");
  const [whole = "0", frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`Use at most ${decimals} decimal places for this token.`);
  const units = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  return units.toString();
}

/** Integer base units → decimal string, trimmed. */
export function fromBaseUnits(units: bigint | string, decimals: number): string {
  const v = BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export type ZcashAddressKind = "unified" | "sapling" | "transparent" | "tex";

/** Light format check for Zcash mainnet addresses. Full validation happens in the wallet / 1Click. */
export function zcashAddressKind(addr: string): ZcashAddressKind | null {
  const a = addr.trim();
  if (/^u1[02-9ac-hj-np-z]{100,}$/.test(a)) return "unified";
  if (/^zs1[02-9ac-hj-np-z]{75}$/.test(a)) return "sapling";
  if (/^tex1[02-9ac-hj-np-z]{38,}$/.test(a)) return "tex";
  if (/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return "transparent";
  return null;
}

/** Cashback must land in the shielded pool: unified or Sapling addresses only. */
export function isShieldedZcashAddress(addr: string): boolean {
  const k = zcashAddressKind(addr);
  return k === "unified" || k === "sapling";
}
