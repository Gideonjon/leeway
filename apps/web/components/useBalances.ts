"use client";
import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { EVM_CHAIN_IDS, isEvmChain } from "@/lib/chains";
import { useNetwork } from "./network";
import type { TokenOption } from "./useTokens";
import { useWallet } from "./Wallet";

const EVM_RPCS: Record<string, string> = {
  eth: "https://ethereum-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  arb: "https://arb1.arbitrum.io/rpc",
  op: "https://mainnet.optimism.io",
  pol: "https://polygon-rpc.com",
  bsc: "https://bsc-dataseed.bnbchain.org",
  avax: "https://api.avax.network/ext/bc/C/rpc",
  gnosis: "https://rpc.gnosischain.com",
  bera: "https://rpc.berachain.com",
};

const TESTNET_BALANCES: Record<string, number> = {
  USDC: 1000,
  USDT: 1000,
  DAI: 1000,
  ETH: 2.5,
  WETH: 2.5,
  SOL: 25,
  ZEC: 10,
  BTC: 0.15,
  WBTC: 0.15,
  cbBTC: 0.15,
  ARB: 500,
  OP: 250,
  POL: 1000,
  BNB: 5,
  AVAX: 40,
  NEAR: 150,
};

function encodeBalanceOf(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return `0x70a08231${clean}`;
}

export function fmtBalance(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (n >= 0.0001) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return "<0.0001";
}

let balanceCache: { key: string; at: number; data: Record<string, number> } | null = null;
let balanceInflight: Promise<Record<string, number>> | null = null;

export function useBalances(tokens: TokenOption[]) {
  const wallet = useWallet();
  const [net] = useNetwork();
  const evmAddr = wallet.evm?.address ?? null;
  const solAddr = wallet.sol?.address ?? null;
  const cacheKey = `${evmAddr ?? ""}:${solAddr ?? ""}`;

  const [balances, setBalances] = useState<Record<string, number>>(() =>
    balanceCache && balanceCache.key === cacheKey ? balanceCache.data : {},
  );
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(
    async (force = false) => {
      if (net === "testnet") return;
      if (!tokens.length) return;
      if (!evmAddr && !solAddr) {
        balanceCache = null;
        setBalances({});
        return;
      }

      if (!force && balanceCache && balanceCache.key === cacheKey && Date.now() - balanceCache.at < 30_000) {
        setBalances(balanceCache.data);
        return;
      }
      if (!force && balanceInflight) {
        const d = await balanceInflight;
        setBalances(d);
        return;
      }

      setLoading(true);
      const next: Record<string, number> = {};

    try {
      const jobs: Promise<void>[] = [];

      // 1. Fetch EVM balances across chains for connected EVM wallet
      if (evmAddr) {
        const byChain = new Map<string, TokenOption[]>();
        for (const t of tokens) {
          if (!isEvmChain(t.blockchain) || !EVM_RPCS[t.blockchain]) continue;
          const list = byChain.get(t.blockchain) ?? [];
          list.push(t);
          byChain.set(t.blockchain, list);
        }

        for (const [chain, chainTokens] of byChain.entries()) {
          const rpc = EVM_RPCS[chain];
          if (!rpc) continue;
          jobs.push(
            (async () => {
              const batch = chainTokens.map((t, idx) => {
                if (!t.contractAddress) {
                  return {
                    jsonrpc: "2.0",
                    id: idx + 1,
                    method: "eth_getBalance",
                    params: [evmAddr, "latest"],
                  };
                }
                return {
                  jsonrpc: "2.0",
                  id: idx + 1,
                  method: "eth_call",
                  params: [{ to: t.contractAddress, data: encodeBalanceOf(evmAddr) }, "latest"],
                };
              });

              try {
                const res = await fetch(rpc, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(batch),
                });
                if (!res.ok) return;
                const payload = await res.json();
                const results = Array.isArray(payload) ? payload : [payload];
                for (const item of results) {
                  const tok = chainTokens[(item?.id ?? 0) - 1];
                  if (!tok || typeof item?.result !== "string" || item.result === "0x") continue;
                  try {
                    const raw = BigInt(item.result);
                    const formatted = Number(formatUnits(raw, tok.decimals));
                    if (Number.isFinite(formatted) && formatted > 0) {
                      next[tok.assetId] = formatted;
                    }
                  } catch {}
                }
              } catch {}
            })(),
          );
        }
      }

      // 2. Fetch Solana native + SPL balances for connected Solana wallet
      if (solAddr) {
        const solTokens = tokens.filter((t) => t.blockchain === "sol");
        if (solTokens.length > 0) {
          jobs.push(
            (async () => {
              try {
                const [balRes, splRes] = await Promise.all([
                  fetch("/api/solana", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ method: "getBalance", params: [solAddr] }),
                  }),
                  fetch("/api/solana", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      method: "getTokenAccountsByOwner",
                      params: [
                        solAddr,
                        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
                        { encoding: "jsonParsed" },
                      ],
                    }),
                  }),
                ]);

                if (balRes.ok) {
                  const d = await balRes.json();
                  const lamports = Number(d?.result?.value ?? 0);
                  const nativeSol = solTokens.find((t) => !t.contractAddress);
                  if (nativeSol && lamports > 0) {
                    next[nativeSol.assetId] = lamports / 1e9;
                  }
                }

                if (splRes.ok) {
                  const d = await splRes.json();
                  const accounts: Array<{
                    account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } };
                  }> = d?.result?.value ?? [];
                  const byMint = new Map<string, number>();
                  for (const acc of accounts) {
                    const info = acc?.account?.data?.parsed?.info;
                    const mint = info?.mint?.toLowerCase();
                    const uiAmount = Number(info?.tokenAmount?.uiAmount ?? 0);
                    if (mint && uiAmount > 0) {
                      byMint.set(mint, (byMint.get(mint) ?? 0) + uiAmount);
                    }
                  }
                  for (const tok of solTokens) {
                    if (!tok.contractAddress) continue;
                    const amt = byMint.get(tok.contractAddress.toLowerCase());
                    if (amt && amt > 0) next[tok.assetId] = amt;
                  }
                }
              } catch {}
            })(),
          );
        }
      }

      const p = Promise.all(jobs).then(() => next);
      balanceInflight = p;
      await p;
      balanceCache = { key: cacheKey, at: Date.now(), data: next };
      setBalances(next);
    } finally {
      balanceInflight = null;
      setLoading(false);
    }
  }, [tokens, evmAddr, solAddr, net, cacheKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const balanceOf = useCallback(
    (token?: TokenOption | null): number => {
      if (!token) return 0;
      if (net === "testnet") {
        return TESTNET_BALANCES[token.symbol] ?? 100;
      }
      // Mainnet: strictly 0 until the wallet for this token's chain is connected and fetched
      const connectedAddr = wallet.addressFor(token.blockchain);
      if (!connectedAddr) return 0;
      return balances[token.assetId] ?? 0;
    },
    [net, wallet, balances],
  );

  const isChainConnected = useCallback(
    (token?: TokenOption | null): boolean => {
      if (!token) return false;
      if (net === "testnet") return true;
      return Boolean(wallet.addressFor(token.blockchain));
    },
    [net, wallet],
  );

  return { balanceOf, isChainConnected, loading, refresh };
}
export { EVM_CHAIN_IDS };
