"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { shortAddr } from "@/lib/chains";
import { ActivityDrawer } from "./ActivityDrawer";
import { useActivity } from "./activity";
import { Mark } from "./Logo";
import { ChainIcon } from "./TokenIcon";
import { useWallet, WalletProvider } from "./Wallet";
import { WalletModal } from "./WalletModal";

const NAV = [
  { href: "/", label: "Ghost Send" },
  { href: "/swap", label: "Swap" },
  { href: "/dca", label: "DCA" },
  { href: "/cashback", label: "Cashback" },
];

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);
  useEffect(() => {
    let t: string | null = null;
    try {
      t = localStorage.getItem("leeway.theme");
    } catch {}
    const initial = (t as "dark" | "light" | null) ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    setTheme(initial);
  }, []);
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("leeway.theme", theme);
    } catch {}
  }, [theme]);
  return (
    <button className="icon-btn" aria-label={theme === "light" ? "Switch to dark" : "Switch to light"} onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}>
      {theme === "light" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

function ConnectButton() {
  const { evm, sol } = useWallet();
  const [open, setOpen] = useState(false);
  const connected = [evm && { key: "evm", icon: evm.icon, chain: "eth", address: evm.address }, sol && { key: "sol", icon: sol.icon, chain: "sol", address: sol.address }].filter(
    Boolean,
  ) as { key: string; icon: string; chain: string; address: string }[];
  return (
    <>
      {connected.length === 0 ? (
        <button className="connect" onClick={() => setOpen(true)}>
          Connect
        </button>
      ) : (
        <button className="connect connect--on" onClick={() => setOpen(true)} aria-label="Wallets">
          <span className="connect__stack">
            {connected.map((c) => (
              <span key={c.key} className="connect__chain">
                <ChainIcon chain={c.chain} size={18} />
              </span>
            ))}
          </span>
          {connected.length === 1 ? shortAddr(connected[0].address, 4, 4) : `${connected.length} wallets`}
        </button>
      )}
      {open && <WalletModal onClose={() => setOpen(false)} />}
    </>
  );
}

function Header() {
  const path = usePathname();
  const items = useActivity();
  const [drawer, setDrawer] = useState(false);
  return (
    <>
      <header className="bar">
        <Link href="/" className="bar__brand" aria-label="Leeway home">
          <Mark size={30} title="" />
          <span className="bar__word">
            lee<em>way</em>
          </span>
        </Link>
        <nav className="seg" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="seg__item" aria-current={path === n.href ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="bar__end">
          <button className="icon-btn icon-btn--count" onClick={() => setDrawer(true)} aria-label={`Activity, ${items.length} transfers`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4l3 7 4-14 3 7h4" />
            </svg>
            {items.length > 0 && <span className="count">{items.length}</span>}
          </button>
          <ThemeToggle />
          <ConnectButton />
        </div>
      </header>
      {drawer && <ActivityDrawer onClose={() => setDrawer(false)} />}
    </>
  );
}

/** The drifting water behind the app: the mark's arcs at scale, and the lantern's glow. */
function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <svg className="backdrop__arcs" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <path className="arc arc--1" d="M-120 1120 A1180 1180 0 0 1 1060 -60" />
        <path className="arc arc--2" d="M80 1160 A980 980 0 0 1 1060 180" />
        <path className="arc arc--3" d="M280 1200 A780 780 0 0 1 1060 420" />
      </svg>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <Backdrop />
      <div className="app">
        <Header />
        {children}
        <footer className="foot">
          <nav aria-label="More">
            <Link href="/track">Track a transfer</Link>
            <Link href="/stats">Numbers</Link>
            <Link href="/privacy">Who can see what</Link>
            <Link href="/terms">Terms</Link>
          </nav>
          <span>Routed by NEAR Intents. Settled in shielded ZEC. Check every address before you send.</span>
        </footer>
      </div>
    </WalletProvider>
  );
}
