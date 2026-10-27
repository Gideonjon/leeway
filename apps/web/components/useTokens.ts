"use client";
import { useEffect, useState } from "react";
import { chainName } from "@/lib/chains";

export interface TokenOption {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price: number;
  contractAddress?: string;
}

export interface PublicConfig {
  appFeeBps: number;
  cashbackBps: number;
  ghostMaxUsd: number;
  ghostMinDelayMin: number;
  ghostMaxDelayMin: number;
  ghostPurgeHours: number;
  dcaContract: string | null;
}

export { chainName };
export const tokenLabel = (t: TokenOption) => `${t.symbol} · ${chainName(t.blockchain)}`;

const RANK = ["USDC", "USDT", "ETH", "BTC", "SOL", "ZEC", "NEAR"];
export function sortTokens(list: TokenOption[]) {
  return [...list].sort((a, b) => {
    const ra = RANK.indexOf(a.symbol), rb = RANK.indexOf(b.symbol);
    if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
    return tokenLabel(a).localeCompare(tokenLabel(b));
  });
}

// Instant seed tokens so the UI renders immediately without waiting for network round-trips.
const SEED_TOKENS: TokenOption[] = [
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", blockchain: "base", decimals: 6, price: 1, contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  { assetId: "nep141:sol.omft.near", symbol: "SOL", blockchain: "sol", decimals: 9, price: 185 },
  { assetId: "nep141:zec.omft.near", symbol: "ZEC", blockchain: "zec", decimals: 8, price: 42.5 },
  { assetId: "nep141:eth.omft.near", symbol: "ETH", blockchain: "eth", decimals: 18, price: 2650 },
  { assetId: "nep141:base.omft.near", symbol: "ETH", blockchain: "base", decimals: 18, price: 2650 },
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", symbol: "USDC", blockchain: "arb", decimals: 6, price: 1, contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", symbol: "USDC", blockchain: "eth", decimals: 6, price: 1, contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  { assetId: "nep141:btc.omft.near", symbol: "BTC", blockchain: "btc", decimals: 8, price: 92000 },
  { assetId: "nep141:wrap.near", symbol: "NEAR", blockchain: "near", decimals: 24, price: 4.8 },
];

const SEED_CONFIG: PublicConfig = {
  appFeeBps: 40,
  cashbackBps: 20,
  ghostMaxUsd: 10000,
  ghostMinDelayMin: 10,
  ghostMaxDelayMin: 90,
  ghostPurgeHours: 24,
  dcaContract: "0x915F54a7774251CA430e68f9d5C220718be2cc09",
};

let cache: { tokens: TokenOption[]; config: PublicConfig } | null = null;
let inflight: Promise<{ tokens: TokenOption[]; config: PublicConfig }> | null = null;

function readSessionCache(): { tokens: TokenOption[]; config: PublicConfig } | null {
  if (cache) return cache;
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("leeway.tokens.v1");
    if (raw) {
      cache = JSON.parse(raw);
      return cache;
    }
  } catch {}
  return null;
}

export function preloadTokens() {
  if (cache) return Promise.resolve(cache);
  inflight ??= Promise.all([fetch("/api/tokens").then((r) => r.json()), fetch("/api/config").then((r) => r.json())]).then(([t, c]) => {
    if (t.error) throw new Error(t.error);
    cache = { tokens: sortTokens(t), config: c };
    try {
      sessionStorage.setItem("leeway.tokens.v1", JSON.stringify(cache));
    } catch {}
    return cache;
  });
  return inflight;
}

export function useTokens() {
  const [state, setState] = useState<{ tokens: TokenOption[]; config: PublicConfig | null; error: string | null }>(() => {
    const warm = readSessionCache();
    return {
      tokens: warm?.tokens ?? SEED_TOKENS,
      config: warm?.config ?? SEED_CONFIG,
      error: null,
    };
  });
  useEffect(() => {
    preloadTokens()
      .then((d) => setState({ tokens: d.tokens, config: d.config, error: null }))
      .catch((e: Error) => {
        inflight = null;
        setState((s) => ({ ...s, error: e.message || "Couldn't reach Leeway. Refresh to try again." }));
      });
  }, []);
  return state;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if ((body as { dry?: boolean } | null)?.dry === true) headers["x-leeway-dry"] = "1";
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: "Unexpected response." }));
  if (!res.ok || data.error) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const fmtUsd = (n: number) =>
  n >= 1000 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function fmtAmount(s: string | number) {
  const n = Number(s);
  if (!Number.isFinite(n)) return String(s);
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return n.toPrecision(4).replace(/\.?0+$/, "");
}
