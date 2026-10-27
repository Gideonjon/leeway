"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { shortAddr } from "@/lib/chains";
import { ZCASH_WALLETS } from "@/lib/payuri";
import { ChainIcon } from "./TokenIcon";
import { useWallet, type EvmOption, type SolOption } from "./Wallet";

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const WALLET_ICONS = {
  walletconnect: svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#3B99FC"/><path d="M12.2 15.6c4.3-4.2 11.3-4.2 15.6 0l.5.5c.2.2.2.6 0 .8l-1.8 1.7a.3.3 0 0 1-.4 0l-.7-.7c-3-2.9-7.8-2.9-10.8 0l-.8.7a.3.3 0 0 1-.4 0l-1.8-1.7a.6.6 0 0 1 0-.8l.6-.5zm19.3 3.6 1.6 1.6c.2.2.2.6 0 .8l-7.2 7a.6.6 0 0 1-.8 0l-5.1-5a.1.1 0 0 0-.2 0l-5.1 5a.6.6 0 0 1-.8 0l-7.2-7a.6.6 0 0 1 0-.8l1.6-1.6a.6.6 0 0 1 .8 0l5.1 5c.1.1.2.1.2 0l5.1-5a.6.6 0 0 1 .8 0l5.1 5c.1.1.2.1.2 0l5.1-5a.6.6 0 0 1 .8 0z" fill="#fff"/></svg>`,
  ),
  metamask: svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#24292E"/><path d="M31.4 8 22 14.9l1.7-4.1L31.4 8z" fill="#E2761B"/><path d="M8.6 8 17.9 15l-1.6-4.2L8.6 8zm19.4 17.7-2.5 3.8 5.4 1.5 1.5-5.2-4.4-.1zm-20.4.1 1.5 5.2 5.4-1.5-2.5-3.8-4.4.1z" fill="#E4761B"/><path d="m14.2 17.4-1.5 2.3 5.3.2-.2-5.7-3.6 3.2zm11.6 0-3.7-3.3-.1 5.8 5.3-.2-1.5-2.3zM14.5 29.5l3.2-1.6-2.8-2.2-.4 3.8zm7.8-1.6 3.2 1.6-.4-3.8-2.8 2.2z" fill="#E4761B"/><path d="m25.5 29.5-3.2-1.6.3 2.1-.1.9 3-1.4zm-11 0 3 1.4-.1-.9.3-2.1-3.2 1.6z" fill="#D7C1B3"/><path d="m17.6 23.7-2.7-.8 1.9-.9.8 1.7zm4.8 0 .8-1.7 1.9.9-2.7.8z" fill="#233447"/><path d="m14.5 29.5.5-3.8-3 .1 2.5 3.7zm10.5-3.8.5 3.8 2.5-3.7-3-.1zm2.3-6-5.3.2.5 2.8.8-1.7 1.9.9 2.1-2.2zm-12.4 1.3 1.9-.9.8 1.7.5-2.8-5.3-.2 2.1 2.2z" fill="#CD6116"/><path d="m12.7 19.7 2.2 4.3-.1-2.1-2.1-2.2zm12.5 2.2-.1 2.1 2.2-4.3-2.1 2.2zm-7.2-2 .1 2.8.6 3.2.2-4.2-.9-1.8zm4 0-.9 1.8.1 4.2.7-3.2.1-2.8z" fill="#E4751F"/><path d="m22.1 22.7-.7 3.2.5.3 2.8-2.2.1-2.1-2.7.8zm-7.2-.8.1 2.1 2.8 2.2.5-.3-.7-3.2-2.7-.8z" fill="#F6851B"/><path d="m22.2 30.9.1-.9-.3-.2h-4l-.2.2.1.9-3-1.4 1 .9 2.1 1.5h4.1l2.1-1.5 1-.9-3 1.4z" fill="#C0AD9E"/><path d="m22.3 27.9-.5-.3h-3.6l-.5.3-.3 2.1.2-.2h4l.3.2-.3-2.1z" fill="#161616"/><path d="m32 15.6.8-3.9L31.4 8l-9.1 6.7 3.5 3 5 1.4 1.1-1.3-.5-.3.8-.7-.6-.5.8-.6-.4-.1zM7.2 11.7l.8 3.9-.5.1.8.6-.6.5.8.7-.5.3 1.1 1.3 5-1.4 3.5-3L8.6 8l-1.4 3.7z" fill="#763D16"/><path d="m30.8 19.1-5-1.4 1.5 2.3-2.2 4.3 2.9-.1h4.4l-1.6-5.1zm-16.6-1.4-5 1.4-1.6 5.1H12l2.9.1-2.2-4.3 1.5-2.3zm7.8 2 .3-5.5 1.4-3.8h-7.4l1.4 3.8.3 5.5.1 1.8v4.2h3.6v-4.2l.3-1.8z" fill="#F6851B"/></svg>`,
  ),
  phantom: svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#AB9FF2"/><path d="M29.4 20.6c-.4-5.4-4.8-9.6-10.5-9.6-6.2 0-11.2 5-11.2 11.2 0 4.5 2.9 7.8 6.3 7.8 1.9 0 3.5-1.1 4.4-2.5.4 1.1 1.4 1.9 2.7 1.9 1.6 0 2.9-1.1 3.4-2.5.5.8 1.3 1.3 2.3 1.3 2.1 0 3.7-2.2 2.6-7.6zm-12.5-.5c-.8 0-1.5-.8-1.5-1.8s.7-1.8 1.5-1.8 1.5.8 1.5 1.8-.7 1.8-1.5 1.8zm5.3 0c-.8 0-1.5-.8-1.5-1.8s.7-1.8 1.5-1.8 1.5.8 1.5 1.8-.7 1.8-1.5 1.8z" fill="#FFFDF8"/></svg>`,
  ),
  rabby: svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#7084FF"/><path d="M26.5 10.5c-2.1 0-4.2 1.8-5.1 4.2-.8-.2-1.7-.3-2.6-.3-5.2 0-9.3 3.7-9.3 8.3 0 3.7 2.7 6.8 6.5 7.9h11c3.3 0 6-2.5 6-5.6 0-2.5-1.8-4.7-4.3-5.4.8-1.6 1.3-3.5 1.3-5.2 0-2.3-1.5-3.9-3.5-3.9zm-3.2 12.2a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2z" fill="#fff"/></svg>`,
  ),
  coinbase: svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#0052FF"/><circle cx="20" cy="20" r="11" fill="#fff"/><rect x="16.2" y="16.2" width="7.6" height="7.6" rx="1.8" fill="#0052FF"/></svg>`,
  ),
  trust: svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#0500FF"/><path d="M20 9.5 11.5 13v7.2c0 5.8 3.6 10.6 8.5 12.3 4.9-1.7 8.5-6.5 8.5-12.3V13L20 9.5z" fill="none" stroke="#00F59B" stroke-width="2.8" stroke-linejoin="round"/></svg>`,
  ),
  solflare: svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#FC7227"/><path d="M21.8 9.5 12 22.2h7.2l-1 8.3L28 17.8h-7.2l1-8.3z" fill="#131517"/></svg>`,
  ),
  backpack: svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#E33E3F"/><path d="M16.5 11.5a3.5 3.5 0 0 1 7 0v1h2a3.5 3.5 0 0 1 3.5 3.5v11a3 3 0 0 1-3 3h-12a3 3 0 0 1-3-3V16a3.5 3.5 0 0 1 3.5-3.5h2v-1zm2 1h3v-1a1.5 1.5 0 0 0-3 0v1zm-3.5 6.5v3h10v-3H15z" fill="#fff"/></svg>`,
  ),
};

interface CatalogWallet {
  id: string;
  name: string;
  icon: string;
  match: RegExp;
  deepLink: (url: string) => string;
}

const EVM_CATALOG: CatalogWallet[] = [
  {
    id: "io.metamask",
    name: "MetaMask",
    icon: WALLET_ICONS.metamask,
    match: /metamask/i,
    deepLink: (u) => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, "")}`,
  },
  {
    id: "app.phantom",
    name: "Phantom",
    icon: WALLET_ICONS.phantom,
    match: /phantom/i,
    deepLink: (u) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(u)}`,
  },
  {
    id: "io.rabby",
    name: "Rabby Wallet",
    icon: WALLET_ICONS.rabby,
    match: /rabby/i,
    deepLink: (u) => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, "")}`,
  },
  {
    id: "com.coinbase.wallet",
    name: "Coinbase Wallet",
    icon: WALLET_ICONS.coinbase,
    match: /coinbase/i,
    deepLink: (u) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}`,
  },
  {
    id: "com.trustwallet.app",
    name: "Trust Wallet",
    icon: WALLET_ICONS.trust,
    match: /trust/i,
    deepLink: (u) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(u)}`,
  },
];

const SOL_CATALOG: CatalogWallet[] = [
  {
    id: "Phantom",
    name: "Phantom",
    icon: WALLET_ICONS.phantom,
    match: /phantom/i,
    deepLink: (u) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(u)}`,
  },
  {
    id: "Solflare",
    name: "Solflare",
    icon: WALLET_ICONS.solflare,
    match: /solflare/i,
    deepLink: (u) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(u)}`,
  },
  {
    id: "Backpack",
    name: "Backpack",
    icon: WALLET_ICONS.backpack,
    match: /backpack/i,
    deepLink: (u) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(u)}`,
  },
];

function WalletIcon({ src, name }: { src: string; name: string }) {
  if (!src) return <span className="wicon wicon--mono">{name.slice(0, 2)}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="wicon" src={src} alt="" width={36} height={36} />;
}

function Row(props: { icon: React.ReactNode; name: string; note?: string; addr?: boolean; action: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  const body = (
    <>
      {props.icon}
      <span className="wrow__text">
        <strong>{props.name}</strong>
        {props.note && <span className={props.addr ? "is-addr" : undefined}>{props.note}</span>}
      </span>
      <span className="wrow__action">{props.action}</span>
    </>
  );
  return props.onClick ? (
    <button type="button" className="wrow" onClick={props.onClick} disabled={props.disabled}>
      {body}
    </button>
  ) : (
    <div className="wrow wrow--static">{body}</div>
  );
}

function WcQr({ uri }: { uri: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    void QRCode.toString(uri, { type: "svg", margin: 0, color: { dark: "#0D1315", light: "#FFFFFF" } }).then(setSvg);
  }, [uri]);
  return (
    <div className="wc">
      <div className="qr qr--lg" role="img" aria-label="WalletConnect QR code" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="hint">Scan with any WalletConnect wallet: Rainbow, Trust, MetaMask Mobile, Uniswap Wallet and more.</p>
      <button type="button" className="copy-btn" onClick={() => void navigator.clipboard?.writeText(uri)}>
        Copy link
      </button>
    </div>
  );
}

export function WalletModal({ onClose }: { onClose: () => void }) {
  const w = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [promptWallet, setPromptWallet] = useState<{ kind: "evm" | "sol"; name: string; icon: string; deepLink: string } | null>(null);
  const [manualAddr, setManualAddr] = useState("");

  useEffect(() => {
    setMounted(true);
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setError(/reject|denied|cancel/i.test(msg) ? "Request cancelled in your wallet." : msg.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  }

  // Merge detected EIP-6963 wallets with standard EVM catalog so mobile & desktop show the exact same options.
  const evmMerged: { id: string; name: string; icon: string; detected?: EvmOption; deepLink?: (u: string) => string }[] = [
    ...w.evmOptions.map((o) => {
      const cat = EVM_CATALOG.find((c) => c.match.test(o.name) || c.id === o.id);
      return { id: o.id, name: o.name, icon: o.icon || cat?.icon || "", detected: o, deepLink: cat?.deepLink };
    }),
  ];
  for (const c of EVM_CATALOG) {
    if (!evmMerged.some((x) => c.match.test(x.name) || x.id === c.id)) {
      evmMerged.push({ id: c.id, name: c.name, icon: c.icon, deepLink: c.deepLink });
    }
  }
  if (w.walletConnectEnabled) {
    evmMerged.push({ id: "walletconnect", name: "WalletConnect", icon: WALLET_ICONS.walletconnect });
  }

  // Merge detected Wallet Standard Solana wallets with standard Solana catalog.
  const solMerged: { id: string; name: string; icon: string; detected?: SolOption; deepLink?: (u: string) => string }[] = [
    ...w.solOptions.map((o) => {
      const cat = SOL_CATALOG.find((c) => c.match.test(o.name) || c.id === o.id);
      return { id: o.id, name: o.name, icon: o.icon || cat?.icon || "", detected: o, deepLink: cat?.deepLink };
    }),
  ];
  for (const c of SOL_CATALOG) {
    if (!solMerged.some((x) => c.match.test(x.name) || x.id === c.id)) {
      solMerged.push({ id: c.id, name: c.name, icon: c.icon, deepLink: c.deepLink });
    }
  }

  function handleEvmPick(item: (typeof evmMerged)[number]) {
    setError(null);
    if (item.id === "walletconnect") {
      void run(item.id, () => w.connectEvm({ id: "walletconnect", name: "WalletConnect", icon: WALLET_ICONS.walletconnect }));
      return;
    }
    const injected = item.detected ?? w.evmOptions[0];
    if (injected?.provider) {
      void run(item.id, () => w.connectEvm({ ...injected, name: item.name, icon: item.icon }));
      return;
    }
    const targetUrl = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?autoconnect=evm` : "https://leeway-production.up.railway.app/?autoconnect=evm";
    const link = item.deepLink ? item.deepLink(targetUrl) : targetUrl;
    setPromptWallet({ kind: "evm", name: item.name, icon: item.icon, deepLink: link });
    setManualAddr("");
    if (typeof window !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      window.location.href = link;
    }
  }

  function handleSolPick(item: (typeof solMerged)[number]) {
    setError(null);
    const injected = item.detected ?? w.solOptions[0];
    if (injected?.wallet) {
      void run(item.id, () => w.connectSol({ ...injected, name: item.name, icon: item.icon }));
      return;
    }
    const targetUrl = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?autoconnect=sol` : "https://leeway-production.up.railway.app/?autoconnect=sol";
    const link = item.deepLink ? item.deepLink(targetUrl) : targetUrl;
    setPromptWallet({ kind: "sol", name: item.name, icon: item.icon, deepLink: link });
    setManualAddr("");
    if (typeof window !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      window.location.href = link;
    }
  }

  function submitManualAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!promptWallet) return;
    const ok = w.connectManual(promptWallet.kind, manualAddr, promptWallet.name, promptWallet.icon);
    if (!ok) {
      setError(promptWallet.kind === "evm" ? "Enter a valid EVM address starting with 0x (42 characters)." : "Enter a valid Solana wallet address.");
      return;
    }
    setPromptWallet(null);
    setManualAddr("");
  }

  if (!mounted) return null;

  return createPortal(
    <div className="sheet-scrim sheet-scrim--wallets" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet sheet--wallets" role="dialog" aria-modal="true" aria-label="Connect wallets">
        <div className="sheet__head">
          <h2>Connect wallets</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="wsheet">
          {w.wcUri ? (
            <WcQr uri={w.wcUri} />
          ) : (
            <>
              <p className="wsheet__intro">Connect one wallet per network. Leeway uses it to fill in your refund address and to pay deposits, and asks your wallet to approve every payment.</p>
              {error && (
                <p className="note note--error" role="alert">
                  {error}
                </p>
              )}

              {promptWallet && (
                <form className="wprompt" onSubmit={submitManualAddress}>
                  <div className="wprompt__head">
                    <WalletIcon src={promptWallet.icon} name={promptWallet.name} />
                    <div className="wprompt__title">
                      <strong>Connect {promptWallet.name}</strong>
                      <span>Open inside the {promptWallet.name} app or paste your address below</span>
                    </div>
                  </div>
                  <a className="cta cta--link wprompt__app-btn" href={promptWallet.deepLink}>
                    Open in {promptWallet.name} App
                  </a>
                  <div className="wprompt__row">
                    <input
                      className="wprompt__input"
                      placeholder={promptWallet.kind === "evm" ? "Or paste 0x… wallet address" : "Or paste Solana wallet address"}
                      value={manualAddr}
                      onChange={(e) => setManualAddr(e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button type="submit" className="chip-btn">
                      Connect
                    </button>
                  </div>
                </form>
              )}

              <section className="wgroup">
                <h3>
                  <ChainIcon chain="eth" size={18} /> EVM
                  <span>Ethereum, Base, Arbitrum, BNB Chain, Polygon and more</span>
                </h3>
                {w.evm ? (
                  <Row
                    icon={<WalletIcon src={w.evm.icon} name={w.evm.name} />}
                    name={w.evm.name}
                    note={shortAddr(w.evm.address, 6, 4)}
                    addr
                    action={<span className="link">Disconnect</span>}
                    onClick={() => w.disconnect("evm")}
                  />
                ) : (
                  evmMerged.map((o) => (
                    <Row
                      key={o.id}
                      icon={<WalletIcon src={o.icon} name={o.name} />}
                      name={o.name}
                      note={o.id === "walletconnect" ? "Scan or connect mobile wallet" : o.detected ? "Detected" : "Detected"}
                      action={busy === o.id ? "Waiting…" : "Connect"}
                      disabled={Boolean(busy)}
                      onClick={() => handleEvmPick(o)}
                    />
                  ))
                )}
              </section>

              <section className="wgroup">
                <h3>
                  <ChainIcon chain="sol" size={18} /> Solana
                  <span>Phantom, Solflare, Backpack and any Wallet Standard wallet</span>
                </h3>
                {w.sol ? (
                  <Row
                    icon={<WalletIcon src={w.sol.icon} name={w.sol.name} />}
                    name={w.sol.name}
                    note={shortAddr(w.sol.address, 6, 4)}
                    addr
                    action={<span className="link">Disconnect</span>}
                    onClick={() => w.disconnect("sol")}
                  />
                ) : (
                  solMerged.map((o) => (
                    <Row
                      key={o.id}
                      icon={<WalletIcon src={o.icon} name={o.name} />}
                      name={o.name}
                      note="Detected"
                      action={busy === o.id ? "Waiting…" : "Connect"}
                      disabled={Boolean(busy)}
                      onClick={() => handleSolPick(o)}
                    />
                  ))
                )}
              </section>

              <section className="wgroup">
                <h3>
                  <ChainIcon chain="zec" size={18} /> Zcash
                  <span>Pays by payment request (ZIP-321): no connection needed</span>
                </h3>
                <div className="zgrid">
                  {ZCASH_WALLETS.map((z) => (
                    <div key={z.id} className="zchip">
                      <strong>{z.name}</strong>
                      <span>{z.note}</span>
                    </div>
                  ))}
                </div>
                <p className="wempty">
                  When you send ZEC, Leeway shows a payment request. Tap <b>Open in Zcash wallet</b> or scan the QR, and your wallet opens with the address and amount filled
                  in. Zcash wallets don&apos;t share your address with websites, which is the point.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
