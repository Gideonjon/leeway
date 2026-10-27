"use client";
/**
 * Multi-wallet connection: any EVM wallet (EIP-6963 discovery, plus WalletConnect for
 * mobile), any Solana wallet (Wallet Standard), and Zcash wallets through ZIP-321
 * payment requests. One EVM and one Solana wallet can be connected at the same time.
 */
import { getWallets } from "@wallet-standard/app";
import type { Wallet as StdWallet, WalletAccount } from "@wallet-standard/base";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, defineChain, erc20Abi, parseUnits, type Address, type EIP1193Provider, type Hash } from "viem";
import { CHAIN_NAMES, EVM_CHAIN_IDS } from "@/lib/chains";

export interface EvmOption {
  id: string; // EIP-6963 rdns, or "walletconnect"
  name: string;
  icon: string;
  provider?: EIP1193Provider;
}
export interface SolOption {
  id: string;
  name: string;
  icon: string;
  wallet: StdWallet;
}
interface EvmConn {
  id: string;
  name: string;
  icon: string;
  address: Address;
  provider?: EIP1193Provider;
}
interface SolConn {
  id: string;
  name: string;
  icon: string;
  address: string;
  wallet?: StdWallet;
  account?: WalletAccount;
}

interface WalletState {
  evm: EvmConn | null;
  sol: SolConn | null;
  evmOptions: EvmOption[];
  solOptions: SolOption[];
  walletConnectEnabled: boolean;
  /** WalletConnect pairing URI while a QR is waiting to be scanned. */
  wcUri: string | null;
  connectEvm: (o: EvmOption) => Promise<EvmConn | null>;
  connectSol: (o: SolOption) => Promise<SolConn | null>;
  connectManual: (kind: "evm" | "sol", address: string, name?: string, icon?: string) => boolean;
  disconnect: (kind: "evm" | "sol") => void;
  /** Address the user controls on a 1Click chain code, if connected. */
  addressFor: (chain: string) => string | null;
  canPay: (chain: string) => boolean;
  pay: (p: { chain: string; to: string; amount: string; decimals: number; contract?: string }) => Promise<string>;
  // Back-compat for the DCA flow (EVM on Base).
  address: Address | null;
  available: boolean;
  connect: () => Promise<Address | null>;
}

const Ctx = createContext<WalletState | null>(null);
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const LS = {
  evm: "leeway.wallet.evm",
  sol: "leeway.wallet.sol",
  evmManual: "leeway.wallet.evm.manual",
  solManual: "leeway.wallet.sol.manual",
};
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {}
  },
};

const CHAIN_META: Record<number, { rpc: string; native: string }> = {
  1: { rpc: "https://ethereum-rpc.publicnode.com", native: "ETH" },
  8453: { rpc: "https://mainnet.base.org", native: "ETH" },
  42161: { rpc: "https://arb1.arbitrum.io/rpc", native: "ETH" },
  10: { rpc: "https://mainnet.optimism.io", native: "ETH" },
  137: { rpc: "https://polygon-rpc.com", native: "POL" },
  56: { rpc: "https://bsc-dataseed.bnbchain.org", native: "BNB" },
  43114: { rpc: "https://api.avax.network/ext/bc/C/rpc", native: "AVAX" },
  100: { rpc: "https://rpc.gnosischain.com", native: "XDAI" },
  80094: { rpc: "https://rpc.berachain.com", native: "BERA" },
};
function viemChain(id: number) {
  const key = Object.keys(EVM_CHAIN_IDS).find((k) => EVM_CHAIN_IDS[k] === id) ?? "";
  const m = CHAIN_META[id];
  return defineChain({
    id,
    name: CHAIN_NAMES[key] ?? `Chain ${id}`,
    nativeCurrency: { name: m?.native ?? "ETH", symbol: m?.native ?? "ETH", decimals: 18 },
    rpcUrls: { default: { http: m ? [m.rpc] : [] } },
  });
}

const WC_ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#3B99FC"/><path d="M12.2 15.6c4.3-4.2 11.3-4.2 15.6 0l.5.5c.2.2.2.6 0 .8l-1.8 1.7a.3.3 0 0 1-.4 0l-.7-.7c-3-2.9-7.8-2.9-10.8 0l-.8.7a.3.3 0 0 1-.4 0l-1.8-1.7a.6.6 0 0 1 0-.8l.6-.5zm19.3 3.6 1.6 1.6c.2.2.2.6 0 .8l-7.2 7a.6.6 0 0 1-.8 0l-5.1-5a.1.1 0 0 0-.2 0l-5.1 5a.6.6 0 0 1-.8 0l-7.2-7a.6.6 0 0 1 0-.8l1.6-1.6a.6.6 0 0 1 .8 0l5.1 5c.1.1.2.1.2 0l5.1-5a.6.6 0 0 1 .8 0l5.1 5c.1.1.2.1.2 0l5.1-5a.6.6 0 0 1 .8 0z" fill="#fff"/></svg>`,
  );

type ConnectFeature = { connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly WalletAccount[] }> };
type DisconnectFeature = { disconnect: () => Promise<void> };
type SignAndSend = {
  signAndSendTransaction: (...inputs: { account: WalletAccount; transaction: Uint8Array; chain: string }[]) => Promise<{ signature: Uint8Array }[]>;
};

function isSolanaWallet(w: StdWallet) {
  return w.chains.some((c) => c.startsWith("solana:")) && "standard:connect" in w.features && "solana:signAndSendTransaction" in w.features;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [evm, setEvm] = useState<EvmConn | null>(null);
  const [sol, setSol] = useState<SolConn | null>(null);
  const [evmOptions, setEvmOptions] = useState<EvmOption[]>([]);
  const [solOptions, setSolOptions] = useState<SolOption[]>([]);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const restored = useRef(false);

  // --- EVM discovery (EIP-6963): every installed wallet announces itself.
  useEffect(() => {
    const found = new Map<string, EvmOption>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<{ info: { rdns: string; name: string; icon: string }; provider: EIP1193Provider }>).detail;
      if (!d?.info?.rdns) return;
      found.set(d.info.rdns, { id: d.info.rdns, name: d.info.name, icon: d.info.icon, provider: d.provider });
      setEvmOptions([...found.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Older or mobile in-app wallets that inject window.ethereum after load.
    const checkLegacy = () => {
      const win = window as unknown as {
        ethereum?: EIP1193Provider & { isMetaMask?: boolean; isRabby?: boolean; isCoinbaseWallet?: boolean; isTrust?: boolean };
        phantom?: { ethereum?: EIP1193Provider };
      };
      const legacy = win.ethereum ?? win.phantom?.ethereum;
      if (found.size === 0 && legacy) {
        const name = win.ethereum?.isRabby
          ? "Rabby Wallet"
          : win.ethereum?.isCoinbaseWallet
            ? "Coinbase Wallet"
            : win.ethereum?.isTrust
              ? "Trust Wallet"
              : win.ethereum?.isMetaMask
                ? "MetaMask"
                : win.phantom?.ethereum
                  ? "Phantom"
                  : "Browser wallet";
        found.set("injected", { id: "injected", name, icon: "", provider: legacy });
        setEvmOptions([...found.values()]);
      }
    };
    const t1 = setTimeout(checkLegacy, 150);
    const t2 = setTimeout(checkLegacy, 600);
    const t3 = setTimeout(checkLegacy, 1400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // --- Solana discovery (Wallet Standard): Phantom, Solflare, Backpack and others register here.
  useEffect(() => {
    const { get, on } = getWallets();
    const refresh = () =>
      setSolOptions(
        get()
          .filter(isSolanaWallet)
          .map((w) => ({ id: w.name, name: w.name, icon: w.icon, wallet: w })),
      );
    refresh();
    const off1 = on("register", refresh);
    const off2 = on("unregister", refresh);
    return () => {
      off1();
      off2();
    };
  }, []);

  const attachEvm = useCallback((o: EvmOption, provider: EIP1193Provider, address: Address) => {
    const conn = { id: o.id, name: o.name, icon: o.icon, address, provider };
    setEvm(conn);
    store.set(LS.evm, o.id);
    store.set(LS.evmManual, null);
    provider.on?.("accountsChanged", (a: unknown) => {
      const next = (a as string[])[0] as Address | undefined;
      setEvm((cur) => (cur && cur.provider === provider ? (next ? { ...cur, address: next } : null) : cur));
    });
    return conn;
  }, []);

  const connectManual = useCallback((kind: "evm" | "sol", rawAddress: string, name?: string, icon = ""): boolean => {
    const trimmed = rawAddress.trim();
    if (kind === "evm") {
      if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return false;
      const wName = name ?? "EVM Wallet";
      setEvm({ id: "manual", name: wName, icon, address: trimmed as Address });
      store.set(LS.evmManual, JSON.stringify({ address: trimmed, name: wName, icon }));
      store.set(LS.evm, null);
      return true;
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return false;
    const wName = name ?? "Solana Wallet";
    setSol({ id: "manual", name: wName, icon, address: trimmed });
    store.set(LS.solManual, JSON.stringify({ address: trimmed, name: wName, icon }));
    store.set(LS.sol, null);
    return true;
  }, []);

  const connectWalletConnect = useCallback(async (): Promise<EvmConn | null> => {
    if (!WC_PROJECT_ID) throw new Error("WalletConnect isn't configured on this deployment.");
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    const provider = await EthereumProvider.init({
      projectId: WC_PROJECT_ID,
      optionalChains: [8453, 1, 42161, 10, 137, 56, 43114, 100],
      showQrModal: false,
      metadata: { name: "Leeway", description: "Private cross-chain payments", url: window.location.origin, icons: [`${window.location.origin}/icon.svg`] },
    });
    provider.on("display_uri", (uri: string) => setWcUri(uri));
    try {
      await provider.connect();
    } finally {
      setWcUri(null);
    }
    const address = provider.accounts[0] as Address | undefined;
    if (!address) return null;
    provider.on("disconnect", () => setEvm(null));
    return attachEvm({ id: "walletconnect", name: "WalletConnect", icon: WC_ICON }, provider as unknown as EIP1193Provider, address);
  }, [attachEvm]);

  const connectEvm = useCallback(
    async (o: EvmOption) => {
      if (o.id === "walletconnect") return connectWalletConnect();
      const provider = o.provider ?? (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (!provider) return null;
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0] as Address | undefined;
      return address ? attachEvm(o, provider, address) : null;
    },
    [attachEvm, connectWalletConnect],
  );

  const connectSol = useCallback(async (o: SolOption, silent = false) => {
    const feat = o.wallet.features["standard:connect"] as ConnectFeature;
    const { accounts } = await feat.connect(silent ? { silent: true } : undefined);
    const account = accounts.find((a) => a.chains.some((c) => c.startsWith("solana:"))) ?? accounts[0];
    if (!account) return null;
    const conn = { id: o.id, name: o.name, icon: o.icon, address: account.address, wallet: o.wallet, account };
    setSol(conn);
    store.set(LS.sol, o.id);
    store.set(LS.solManual, null);
    return conn;
  }, []);

  // --- Restore manual addresses immediately on mount.
  useEffect(() => {
    const evmM = store.get(LS.evmManual);
    if (evmM) {
      try {
        const parsed = JSON.parse(evmM) as { address: Address; name: string; icon?: string };
        if (/^0x[0-9a-fA-F]{40}$/.test(parsed.address)) {
          setEvm((cur) => cur ?? { id: "manual", name: parsed.name || "EVM Wallet", icon: parsed.icon || "", address: parsed.address });
        }
      } catch {}
    }
    const solM = store.get(LS.solManual);
    if (solM) {
      try {
        const parsed = JSON.parse(solM) as { address: string; name: string; icon?: string };
        if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(parsed.address)) {
          setSol((cur) => cur ?? { id: "manual", name: parsed.name || "Solana Wallet", icon: parsed.icon || "", address: parsed.address });
        }
      } catch {}
    }
  }, []);

  // --- Restore last session silently, or auto-connect when deep-linked into a wallet app.
  useEffect(() => {
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const auto = params?.get("autoconnect");
    if (auto === "evm" && evmOptions.length > 0 && !evm) {
      void connectEvm(evmOptions[0]).catch(() => undefined);
    } else if (auto === "sol" && solOptions.length > 0 && !sol) {
      void connectSol(solOptions[0]).catch(() => undefined);
    }

    if (restored.current) return;
    const evmId = store.get(LS.evm);
    const solId = store.get(LS.sol);
    const e = evmId && evmOptions.find((o) => o.id === evmId);
    const s = solId && solOptions.find((o) => o.id === solId);
    if ((evmId && !e && evmOptions.length === 0) || (solId && !s && solOptions.length === 0)) return; // still discovering
    restored.current = true;
    if (e && e.provider) {
      void e.provider
        .request({ method: "eth_accounts" })
        .then((a) => {
          const addr = (a as string[])[0] as Address | undefined;
          if (addr) attachEvm(e, e.provider!, addr);
        })
        .catch(() => undefined);
    }
    if (s) void connectSol(s, true).catch(() => undefined);
  }, [evmOptions, solOptions, evm, sol, attachEvm, connectEvm, connectSol]);

  const disconnect = useCallback((kind: "evm" | "sol") => {
    if (kind === "evm") {
      setEvm((cur) => {
        if (cur?.id === "walletconnect") void (cur.provider as unknown as { disconnect?: () => Promise<void> }).disconnect?.();
        return null;
      });
      store.set(LS.evm, null);
      store.set(LS.evmManual, null);
    } else {
      setSol((cur) => {
        const f = cur?.wallet?.features["standard:disconnect"] as DisconnectFeature | undefined;
        void f?.disconnect().catch(() => undefined);
        return null;
      });
      store.set(LS.sol, null);
      store.set(LS.solManual, null);
    }
  }, []);

  const addressFor = useCallback(
    (chain: string) => (chain in EVM_CHAIN_IDS ? (evm?.address ?? null) : chain === "sol" ? (sol?.address ?? null) : null),
    [evm, sol],
  );
  const canPay = useCallback(
    (chain: string) =>
      chain in EVM_CHAIN_IDS
        ? evmOptions.length > 0 || Boolean(WC_PROJECT_ID) || Boolean(evm?.provider)
        : chain === "sol"
          ? solOptions.length > 0 || Boolean(sol?.wallet)
          : false,
    [evmOptions, solOptions, evm, sol],
  );

  const pay = useCallback<WalletState["pay"]>(
    async ({ chain, to, amount, decimals, contract }) => {
      if (chain === "sol") {
        if (!sol?.wallet || !sol.account) throw new Error("Open in your Solana wallet app to sign this transfer.");
        const { base58, buildDepositTx } = await import("@/lib/solana");
        const tx = await buildDepositTx({ from: sol.address, to, amount: parseUnits(amount, decimals), mint: contract || undefined, decimals });
        const feat = sol.wallet.features["solana:signAndSendTransaction"] as SignAndSend;
        const [res] = await feat.signAndSendTransaction({ account: sol.account, transaction: tx, chain: "solana:mainnet" });
        return base58(res.signature);
      }
      const id = EVM_CHAIN_IDS[chain];
      if (!id) throw new Error("Pay from your wallet app for this chain.");
      if (!evm?.provider) throw new Error("Open in your EVM wallet app to sign this transfer.");
      const w = createWalletClient({ chain: viemChain(id), transport: custom(evm.provider), account: evm.address });
      const current = Number(await evm.provider.request({ method: "eth_chainId" }));
      if (current !== id) {
        try {
          await w.switchChain({ id });
        } catch {
          await w.addChain({ chain: viemChain(id) });
        }
      }
      const value = parseUnits(amount, decimals);
      let hash: Hash;
      if (contract && /^0x[0-9a-fA-F]{40}$/.test(contract)) {
        hash = await w.writeContract({ address: contract as Address, abi: erc20Abi, functionName: "transfer", args: [to as Address, value], chain: null });
      } else {
        hash = await w.sendTransaction({ to: to as Address, value, chain: null });
      }
      return hash;
    },
    [evm, sol],
  );

  const legacyConnect = useCallback(async () => {
    if (evm) return evm.address;
    const o = evmOptions[0];
    return o ? ((await connectEvm(o))?.address ?? null) : null;
  }, [evm, evmOptions, connectEvm]);

  const value = useMemo<WalletState>(
    () => ({
      evm,
      sol,
      evmOptions,
      solOptions,
      walletConnectEnabled: Boolean(WC_PROJECT_ID),
      wcUri,
      connectEvm,
      connectSol: (o) => connectSol(o),
      connectManual,
      disconnect,
      addressFor,
      canPay,
      pay,
      address: evm?.address ?? null,
      available: evmOptions.length > 0,
      connect: legacyConnect,
    }),
    [evm, sol, evmOptions, solOptions, wcUri, connectEvm, connectSol, connectManual, disconnect, addressFor, canPay, pay, legacyConnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
