"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { chainName } from "@/lib/chains";
import { clearActivity, useActivity, type ActivityItem } from "./activity";
import { TokenIcon } from "./TokenIcon";
import { fmtAmount } from "./useTokens";

export type Phase = "waiting" | "moving" | "shielded" | "settled" | "failed";

export function phaseOf(data: { type: string; state?: string; status?: string; review?: boolean } | null): { phase: Phase; label: string } {
  if (!data) return { phase: "waiting", label: "Checking" };
  if (data.review) return { phase: "waiting", label: "Being checked" };
  if (data.type === "ghost") {
    switch (data.state) {
      case "awaiting_deposit":
        return { phase: "waiting", label: "Awaiting deposit" };
      case "shielding":
        return { phase: "moving", label: "Leg one" };
      case "holding":
        return { phase: "shielded", label: "Holding" };
      case "sending_leg2":
      case "leg2_pending":
        return { phase: "moving", label: "Leg two" };
      case "completed":
        return { phase: "settled", label: "Delivered" };
      case "refunded":
        return { phase: "failed", label: "Refunded" };
      default:
        return { phase: "failed", label: "Stopped" };
    }
  }
  switch (data.status) {
    case "PENDING_DEPOSIT":
      return { phase: "waiting", label: "Awaiting deposit" };
    case "SUCCESS":
      return { phase: "settled", label: "Delivered" };
    case "REFUNDED":
      return { phase: "failed", label: "Refunded" };
    case "FAILED":
      return { phase: "failed", label: "Failed" };
    default:
      return { phase: "moving", label: "Swapping" };
  }
}

function Row({ item }: { item: ActivityItem }) {
  const [data, setData] = useState<{ type: string; state?: string; status?: string } | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/track/${encodeURIComponent(item.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => live && setData(d));
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [item.id]);
  const { phase, label } = phaseOf(data);
  return (
    <li>
      <Link href={`/track?code=${encodeURIComponent(item.id)}`} className="act-row">
        <span className="act-row__pair">
          <TokenIcon symbol={item.fromSymbol} chain={item.fromChain} size={30} />
          <TokenIcon symbol={item.toSymbol} chain={item.toChain} size={30} />
        </span>
        <span className="act-row__text">
          <strong>
            {fmtAmount(item.amount)} {item.fromSymbol} to {item.toSymbol}
          </strong>
          <span>
            {item.kind === "ghost" ? "Ghost Send" : "Swap"}, {chainName(item.fromChain)} to {chainName(item.toChain)}
          </span>
        </span>
        <span className={`pill pill--${phase}`}>{label}</span>
      </Link>
    </li>
  );
}

export function ActivityDrawer({ onClose }: { onClose: () => void }) {
  const items = useActivity();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="sheet-scrim sheet-scrim--side" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Activity">
        <div className="sheet__head">
          <h2>Activity</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {items.length === 0 ? (
          <p className="drawer__empty">Transfers you start in this browser show up here. Leeway keeps no account for you, so this list lives only on this device.</p>
        ) : (
          <>
            <ul className="act-list">
              {items.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </ul>
            <button type="button" className="text-btn" onClick={clearActivity}>
              Clear this list
            </button>
          </>
        )}
      </aside>
    </div>,
    document.body,
  );
}
