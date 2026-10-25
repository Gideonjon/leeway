"use client";
import { useEffect, useState } from "react";

export interface TokenOption {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price: number;
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

const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum", base: "Base", arb: "Arbitrum", sol: "Solana", btc: "Bitcoin", zec: "Zcash", near: "NEAR",
  bsc: "BNB Chain", pol: "Polygon", tron: "Tron", op: "Optimism", avax: "Avalanche", ton: "TON", sui: "Sui",
  doge: "Dogecoin", xrp: "XRP", ltc: "Litecoin", gnosis: "Gnosis", bera: "Berachain", stellar: "Stellar",
};
export const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();
export const tokenLabel = (t: TokenOption) => `${t.symbol} · ${chainName(t.blockchain)}`;

/** Popular pairs float to the top of the pickers. */
const RANK = ["USDC", "USDT", "ETH", "BTC", "SOL", "ZEC"];
export function sortTokens(list: TokenOption[]) {
  return [...list].sort((a, b) => {
    const ra = RANK.indexOf(a.symbol), rb = RANK.indexOf(b.symbol);
    if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
    return tokenLabel(a).localeCompare(tokenLabel(b));
  });
}

export function useTokens() {
  const [tokens, setTokens] = useState<TokenOption[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([fetch("/api/tokens").then((r) => r.json()), fetch("/api/config").then((r) => r.json())])
      .then(([t, c]) => {
        if (t.error) setError(t.error);
        else setTokens(sortTokens(t));
        setConfig(c);
      })
      .catch(() => setError("Couldn't reach Leeway. Refresh to try again."));
  }, []);
  return { tokens, config, error };
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: "Unexpected response." }));
  if (!res.ok || data.error) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}
