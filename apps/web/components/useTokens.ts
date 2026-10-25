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

let cache: { tokens: TokenOption[]; config: PublicConfig } | null = null;
let inflight: Promise<{ tokens: TokenOption[]; config: PublicConfig }> | null = null;

function loadAll() {
  if (cache) return Promise.resolve(cache);
  inflight ??= Promise.all([fetch("/api/tokens").then((r) => r.json()), fetch("/api/config").then((r) => r.json())]).then(([t, c]) => {
    if (t.error) throw new Error(t.error);
    cache = { tokens: sortTokens(t), config: c };
    return cache;
  });
  return inflight;
}

export function useTokens() {
  const [state, setState] = useState<{ tokens: TokenOption[]; config: PublicConfig | null; error: string | null }>(() => ({
    tokens: cache?.tokens ?? [],
    config: cache?.config ?? null,
    error: null,
  }));
  useEffect(() => {
    loadAll()
      .then((d) => setState({ tokens: d.tokens, config: d.config, error: null }))
      .catch((e: Error) => {
        inflight = null;
        setState((s) => ({ ...s, error: e.message || "Couldn't reach Leeway. Refresh to try again." }));
      });
  }, []);
  return state;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
