"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { shortAddr } from "@/lib/chains";
import { ZCASH_WALLETS } from "@/lib/payuri";
import { ChainIcon } from "./TokenIcon";
import { useWallet, type EvmOption, type SolOption } from "./Wallet";

const EVM_FALLBACK_WALLETS = [
  {
    id: "metamask-link",
    name: "MetaMask",
    badge: "MM",
    color: "#E2761B",
    href: (url: string) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
  {
    id: "coinbase-link",
    name: "Coinbase Wallet",
    badge: "CB",
    color: "#0052FF",
    href: (url: string) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  },
  {
    id: "trust-link",
    name: "Trust Wallet",
    badge: "TW",
    color: "#0500FF",
    href: (url: string) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`,
  },
];

const SOL_FALLBACK_WALLETS = [
  {
    id: "phantom-link",
    name: "Phantom",
    badge: "PH",
    color: "#AB9FF2",
    href: (url: string) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(url)}`,
  },
  {
    id: "solflare-link",
    name: "Solflare",
    badge: "SF",
    color: "#FC7227",
    href: (url: string) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(url)}`,
  },
];

function WalletIcon({ src, name, color }: { src: string; name: string; color?: string }) {
  if (!src) {
    return (
      <span className="wicon wicon--mono" style={color ? { background: color, color: "#fff" } : undefined}>
        {name.slice(0, 2)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="wicon" src={src} alt="" width={36} height={36} />;
}

function Row(props: { icon: React.ReactNode; name: string; note?: string; addr?: boolean; action: React.ReactNode; onClick?: () => void; href?: string; disabled?: boolean }) {
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
  if (props.href) {
    return (
      <a className="wrow wrow--link" href={props.href} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    );
  }
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
  const [pageUrl, setPageUrl] = useState("https://leeway-production.up.railway.app");

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") setPageUrl(window.location.href);
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

  const evmList: EvmOption[] = [...w.evmOptions, ...(w.walletConnectEnabled ? [{ id: "walletconnect", name: "WalletConnect", icon: "" }] : [])];

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
                ) : evmList.length ? (
                  evmList.map((o) => (
                    <Row
                      key={o.id}
                      icon={o.id === "walletconnect" ? <span className="wicon wicon--wc">WC</span> : <WalletIcon src={o.icon} name={o.name} />}
                      name={o.name}
                      note={o.id === "walletconnect" ? "Scan with a mobile wallet" : "Detected"}
                      action={busy === o.id ? "Waiting…" : "Connect"}
                      disabled={Boolean(busy)}
                      onClick={() => void run(o.id, () => w.connectEvm(o))}
                    />
                  ))
                ) : (
                  <>
                    {EVM_FALLBACK_WALLETS.map((fw) => (
                      <Row
                        key={fw.id}
                        icon={<WalletIcon src="" name={fw.badge} color={fw.color} />}
                        name={fw.name}
                        note="Open in wallet app"
                        action="Open"
                        href={fw.href(pageUrl)}
                      />
                    ))}
                  </>
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
                ) : w.solOptions.length ? (
                  w.solOptions.map((o: SolOption) => (
                    <Row
                      key={o.id}
                      icon={<WalletIcon src={o.icon} name={o.name} />}
                      name={o.name}
                      note="Detected"
                      action={busy === o.id ? "Waiting…" : "Connect"}
                      disabled={Boolean(busy)}
                      onClick={() => void run(o.id, () => w.connectSol(o))}
                    />
                  ))
                ) : (
                  <>
                    {SOL_FALLBACK_WALLETS.map((fw) => (
                      <Row
                        key={fw.id}
                        icon={<WalletIcon src="" name={fw.badge} color={fw.color} />}
                        name={fw.name}
                        note="Open in wallet app"
                        action="Open"
                        href={fw.href(pageUrl)}
                      />
                    ))}
                  </>
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
