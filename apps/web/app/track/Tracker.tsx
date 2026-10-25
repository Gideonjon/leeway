"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { phaseOf } from "@/components/ActivityDrawer";
import { fmtUsd } from "@/components/useTokens";

interface Data {
  type: "ghost" | "swap";
  code?: string;
  state?: string;
  status?: string;
  amountInUsd: string | null;
  releaseAt?: string | null;
  purged?: boolean;
  error?: string | null;
}

const GHOST_STEPS = [
  { title: "Deposit", detail: "Starts when your funds arrive." },
  { title: "Leg one", detail: "Your funds become ZEC." },
  { title: "Held in the shielded pool", detail: "A random wait breaks the timing link.", shielded: true },
  { title: "Leg two", detail: "ZEC becomes the asset they asked for." },
  { title: "Delivered", detail: "In their wallet." },
];
const GHOST_INDEX: Record<string, number> = { awaiting_deposit: 0, shielding: 1, holding: 2, sending_leg2: 3, leg2_pending: 3, completed: 5 };

export function Tracker() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("code") ?? "";
  const [input, setInput] = useState(code);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (c: string) => {
    const r = await fetch(`/api/track/${encodeURIComponent(c)}`);
    const d = await r.json();
    if (!r.ok) {
      setData(null);
      setError(d.error);
    } else {
      setError(null);
      setData(d);
    }
  }, []);

  useEffect(() => {
    if (!code) return;
    void load(code);
    const t = setInterval(() => void load(code), 10_000);
    return () => clearInterval(t);
  }, [code, load]);

  const { phase, label } = phaseOf(data);
  const idx = data?.type === "ghost" ? (GHOST_INDEX[data.state ?? ""] ?? -1) : -1;
  const holdLeft = data?.releaseAt ? Math.ceil((new Date(data.releaseAt).getTime() - Date.now()) / 60_000) : null;

  return (
    <>
      <form
        className="opts"
        onSubmit={(e) => {
          e.preventDefault();
          router.replace(`/track?code=${encodeURIComponent(input.trim())}`);
        }}
      >
        <label className="opt">
          <span className="opt__label">Code</span>
          <input className="opt__input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="lw-xxxx-xxxx" spellCheck={false} autoComplete="off" />
        </label>
        <button className="cta" type="submit" disabled={!input.trim()}>
          Track
        </button>
      </form>

      {error && (
        <p className="note note--error" role="alert">
          {error}
        </p>
      )}

      {data && (
        <div className="track" aria-live="polite">
          <div className="deposit__top">
            <span className={`pill pill--${phase}`}>{label}</span>
            {data.amountInUsd && <span className="deposit__timer">{fmtUsd(Number(data.amountInUsd))}</span>}
          </div>
          {data.type === "ghost" && phase !== "failed" ? (
            <ol className="psteps">
              {GHOST_STEPS.map((s, i) => (
                <li key={s.title} className={`pstep pstep--${i < idx ? "done" : i === idx ? "now" : "todo"} ${s.shielded ? "pstep--shielded" : ""}`}>
                  <span className="pstep__icon pstep__icon--dot" />
                  <div className="pstep__body">
                    <div className="pstep__title">{s.title}</div>
                    <div className="pstep__detail">{i === 2 && i === idx && holdLeft && holdLeft > 0 ? `Leg two leaves in about ${holdLeft} min.` : s.detail}</div>
                  </div>
                </li>
              ))}
            </ol>
          ) : phase === "failed" ? (
            <p className="note note--error">{data.state === "refunded" || data.status === "REFUNDED" ? "Refunded to your address. Nothing was lost." : (data.error ?? "This transfer stopped. Contact support with your code.")}</p>
          ) : null}
          {data.purged && <p className="hint">The link between sender and recipient has been erased.</p>}
        </div>
      )}
    </>
  );
}
