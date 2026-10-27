"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CHAIN_ORDER, chainName } from "@/lib/chains";
import { ChainIcon, TokenIcon } from "./TokenIcon";
import { fmtBalance, useBalances } from "./useBalances";
import { fmtUsd, type TokenOption } from "./useTokens";

export function TokenPicker(props: {
  title: string;
  tokens: TokenOption[];
  exclude?: string;
  onPick: (t: TokenOption) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [chain, setChain] = useState<string | "all">("all");
  const { balanceOf } = useBalances(props.tokens);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [props]);

  const chains = useMemo(() => {
    const present = new Set(props.tokens.map((t) => t.blockchain));
    const ordered = CHAIN_ORDER.filter((c) => present.has(c));
    return [...ordered, ...[...present].filter((c) => !ordered.includes(c)).sort()];
  }, [props.tokens]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = props.tokens.filter(
      (t) =>
        t.assetId !== props.exclude &&
        (chain === "all" || t.blockchain === chain) &&
        (!needle || t.symbol.toLowerCase().includes(needle) || chainName(t.blockchain).toLowerCase().includes(needle) || t.contractAddress?.toLowerCase() === needle),
    );
    return filtered.sort((a, b) => {
      const balA = balanceOf(a) * a.price;
      const balB = balanceOf(b) * b.price;
      if (balB !== balA) return balB - balA;
      return 0;
    });
  }, [props.tokens, props.exclude, chain, q, balanceOf]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="sheet-scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title} ref={dialog}>
        <div className="sheet__head">
          <h2>{props.title}</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="picker">
          <nav className="picker__chains" aria-label="Filter by chain">
            <button type="button" className={`chain-chip ${chain === "all" ? "is-on" : ""}`} onClick={() => setChain("all")} title="All chains">
              <span className="chain-chip__all">All</span>
            </button>
            {chains.map((c) => (
              <button type="button" key={c} className={`chain-chip ${chain === c ? "is-on" : ""}`} onClick={() => setChain(c)} title={chainName(c)} aria-label={chainName(c)}>
                <ChainIcon chain={c} size={28} />
              </button>
            ))}
          </nav>
          <div className="picker__main">
            <label className="search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={chain === "all" ? "Search tokens and chains" : `Search on ${chainName(chain)}`} aria-label="Search tokens" />
            </label>
            {chain !== "all" && <div className="picker__context">{chainName(chain)}</div>}
            <ul className="token-list" role="listbox" aria-label="Tokens">
              {list.slice(0, 200).map((t) => {
                const bal = balanceOf(t);
                return (
                  <li key={t.assetId}>
                    <button type="button" role="option" aria-selected="false" className="token-row" onClick={() => props.onPick(t)}>
                      <TokenIcon symbol={t.symbol} chain={t.blockchain} size={40} />
                      <span className="token-row__name">
                        <strong>{t.symbol}</strong>
                        <span>{chainName(t.blockchain)}</span>
                      </span>
                      <span className="token-row__bal">
                        <strong>{fmtBalance(bal)}</strong>
                        {bal > 0 && <span>{fmtUsd(bal * t.price)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
              {list.length === 0 && <li className="token-list__empty">No match. Try the symbol, like USDC, or pick All chains.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
