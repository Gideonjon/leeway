"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, defineChain, erc20Abi, parseUnits, type Address, type EIP1193Provider, type Hash } from "viem";
import { CHAIN_NAMES, EVM_CHAIN_IDS } from "@/lib/chains";

interface WalletState {
  address: Address | null;
  chainId: number | null;
  available: boolean;
  connect: () => Promise<Address | null>;
  disconnect: () => void;
  /** Sends `amount` of a token on an EVM chain to a deposit address. Native when no contract. */
  pay: (p: { chain: string; to: string; amount: string; decimals: number; contract?: string }) => Promise<Hash>;
}

const Ctx = createContext<WalletState | null>(null);

function provider(): EIP1193Provider | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

/** Public RPCs and native currencies, used only if the wallet needs the chain added. */
const CHAIN_META: Record<number, { rpc: string; native: string; explorer: string }> = {
  1: { rpc: "https://ethereum-rpc.publicnode.com", native: "ETH", explorer: "https://etherscan.io" },
  8453: { rpc: "https://mainnet.base.org", native: "ETH", explorer: "https://basescan.org" },
  42161: { rpc: "https://arb1.arbitrum.io/rpc", native: "ETH", explorer: "https://arbiscan.io" },
  10: { rpc: "https://mainnet.optimism.io", native: "ETH", explorer: "https://optimistic.etherscan.io" },
  137: { rpc: "https://polygon-rpc.com", native: "POL", explorer: "https://polygonscan.com" },
  56: { rpc: "https://bsc-dataseed.bnbchain.org", native: "BNB", explorer: "https://bscscan.com" },
  43114: { rpc: "https://api.avax.network/ext/bc/C/rpc", native: "AVAX", explorer: "https://snowtrace.io" },
  100: { rpc: "https://rpc.gnosischain.com", native: "XDAI", explorer: "https://gnosisscan.io" },
  80094: { rpc: "https://rpc.berachain.com", native: "BERA", explorer: "https://berascan.com" },
};

function viemChain(id: number) {
  const key = Object.keys(EVM_CHAIN_IDS).find((k) => EVM_CHAIN_IDS[k] === id) ?? "";
  const meta = CHAIN_META[id];
  return defineChain({
    id,
    name: CHAIN_NAMES[key] ?? `Chain ${id}`,
    nativeCurrency: { name: meta?.native ?? "ETH", symbol: meta?.native ?? "ETH", decimals: 18 },
    rpcUrls: { default: { http: meta ? [meta.rpc] : [] } },
    blockExplorers: meta ? { default: { name: "Explorer", url: meta.explorer } } : undefined,
  });
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const eth = provider();
    setAvailable(Boolean(eth));
    if (!eth) return;
    let wanted = false;
    try {
      wanted = localStorage.getItem("leeway.wallet") === "1";
    } catch {}
    if (wanted) {
      void eth.request({ method: "eth_accounts" }).then((a) => setAddress(((a as string[])[0] as Address) ?? null));
    }
    void eth.request({ method: "eth_chainId" }).then((c) => setChainId(Number(c)));
    const onAccounts = (a: unknown) => setAddress(((a as string[])[0] as Address) ?? null);
    const onChain = (c: unknown) => setChainId(Number(c));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = provider();
    if (!eth) return null;
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    const a = (accounts[0] as Address) ?? null;
    setAddress(a);
    try {
      localStorage.setItem("leeway.wallet", "1");
    } catch {}
    return a;
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    try {
      localStorage.removeItem("leeway.wallet");
    } catch {}
  }, []);

  const pay = useCallback<WalletState["pay"]>(
    async ({ chain, to, amount, decimals, contract }) => {
      const eth = provider();
      if (!eth) throw new Error("No wallet found.");
      const id = EVM_CHAIN_IDS[chain];
      if (!id) throw new Error("Pay from your wallet app for this chain.");
      const from = address ?? (await connect());
      if (!from) throw new Error("Connect a wallet first.");
      const wallet = createWalletClient({ chain: viemChain(id), transport: custom(eth), account: from });
      if (chainId !== id) {
        try {
          await wallet.switchChain({ id });
        } catch {
          await wallet.addChain({ chain: viemChain(id) });
        }
      }
      const value = parseUnits(amount, decimals);
      if (contract && /^0x[0-9a-fA-F]{40}$/.test(contract)) {
        return wallet.writeContract({ address: contract as Address, abi: erc20Abi, functionName: "transfer", args: [to as Address, value], chain: null });
      }
      return wallet.sendTransaction({ to: to as Address, value, chain: null });
    },
    [address, chainId, connect],
  );

  const value = useMemo(() => ({ address, chainId, available, connect, disconnect, pay }), [address, chainId, available, connect, disconnect, pay]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
