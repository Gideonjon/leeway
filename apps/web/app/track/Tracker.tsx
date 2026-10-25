"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type GhostState = "awaiting_deposit" | "shielding" | "holding" | "sending_leg2" | "leg2_pending" | "completed" | "refunded" | "failed";

interface GhostStatus {
  type: "ghost";
  code: string;
  state: GhostState;
  depositAddress: string | null;
  amountInUsd: string | null;
  releaseAt: string | null;
  completedAt: string | null;
  purged: boolean;
  error: string | null;
}
interface SwapStatus {
  type: "swap";
  status: string;
  amountInUsd: string | null;
  createdAt: string;
}

const STAGES: { key: string; title: string; detail: string; shielded?: boolean }[] = [
  { key: "awaiting_deposit", title: "Waiting for your deposit", detail: "Starts as soon as your funds arrive." },
  { key: "leg1", title: "Leg one", detail: "Your funds become ZEC." },
  { key: "holding", title: "Holding in the shielded pool", detail: "A random wait breaks the timing link.", shielded: true },
  { key: "leg2", title: "Leg two", detail: "ZEC becomes the asset they asked for." },
  { key: "completed", title: "Delivered", detail: "It's in their wallet." },
];

function stageIndex(state: GhostState): number {
  switch (state) {
    case "awaiting_deposit":
      return 0;
    case "shielding":
      return 1;
    case "holding":
      return 2;
    case "sending_leg2":
    case "leg2_pending":
      return 3;
    case "completed":
      return 5;
    default:
      return -1;
  }
}

function minutesUntil(iso: string | null) {
  if (!iso) return null;
  const m = Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000);
  return m > 0 ? m : null;
}

export function Tracker() {
  const params = useSearchParams();
  const router = useRouter();
  const [input, setInput] = useState(params.get("code") ?? "");
  const [result, setResult] = useState<GhostStatus | SwapStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (code: string) => {
    if (!code) return;
    const res = await fetch(`/api/track/${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!res.ok) {
      setResult(null);
      setError(data.error);
    } else {
      setError(null);
      setResult(data);
    }
  }, []);

  const code = params.get("code") ?? "";
  useEffect(() => {
    if (!code) return;
    void load(code);
    const t = setInterval(() => void load(code), 15_000);
    return () => clearInterval(t);
  }, [code, load]);

  return (
    <>
      <form
        className="card"
        style={{ display: "grid", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          router.replace(`/track?code=${encodeURIComponent(input.trim())}`);
        }}
      >
        <label className="field__label" htmlFor="code">
          Tracking code or deposit address
        </label>
        <div className="deposit__addr">
          <input id="code" className="input input--mono" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} autoComplete="off" />
          <button className="btn btn--secondary" type="submit">
            Track
          </button>
        </div>
      </form>

      {error && (
        <p className="notice notice--error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}

      {result?.type === "ghost" && <GhostView g={result} />}
      {result?.type === "swap" && (
        <div className="card" style={{ marginTop: 16 }}>
          <span className={`pill ${result.status === "SUCCESS" ? "pill--settled" : ["REFUNDED", "FAILED"].includes(result.status) ? "pill--failed" : "pill--moving"}`}>
            {result.status === "SUCCESS" ? "Delivered" : result.status === "REFUNDED" ? "Refunded" : result.status === "FAILED" ? "Failed" : result.status === "PENDING_DEPOSIT" ? "Awaiting deposit" : "Swapping"}
          </span>
          {result.amountInUsd && <p style={{ margin: "12px 0 0", color: "var(--ink-muted)" }}>${Number(result.amountInUsd).toFixed(2)} swap</p>}
        </div>
      )}
    </>
  );
}

function GhostView({ g }: { g: GhostStatus }) {
  const idx = stageIndex(g.state);
  const ended = g.state === "refunded" || g.state === "failed";
  const wait = minutesUntil(g.releaseAt);
  return (
    <div className="card" style={{ marginTop: 16 }} aria-live="polite">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <code style={{ fontFamily: "var(--font-mono)" }}>{g.code}</code>
        {g.amountInUsd && <span style={{ color: "var(--ink-muted)" }}>${Number(g.amountInUsd).toFixed(2)}</span>}
      </div>

      {ended ? (
        <p className="notice notice--error" style={{ marginTop: 16 }}>
          {g.state === "refunded" ? "Leg one was refunded to your address. Nothing was lost." : g.error ?? "This send stopped. Contact support with your code."}
        </p>
      ) : (
        <ol className="timeline">
          {STAGES.map((s, i) => (
            <li key={s.key} data-done={i < idx} data-now={i === idx} data-shielded={s.shielded ?? false}>
              <div>
                <strong>{s.title}</strong>
                <span>{i === 2 && i === idx && wait ? `Leg two leaves in about ${wait} min.` : s.detail}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {g.depositAddress && (
        <p className="field__hint">
          Deposit address: <code style={{ fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{g.depositAddress}</code>
        </p>
      )}
      {g.purged && <p className="field__hint">The link between sender and recipient has been erased.</p>}
    </div>
  );
}
