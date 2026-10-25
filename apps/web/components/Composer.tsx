"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DepositInstructions } from "./Deposit";
import { chainName, postJson, tokenLabel, useTokens, type TokenOption } from "./useTokens";

type Mode = "ghost" | "swap" | "dca";

interface Preview {
  amountOut: string;
  amountOutUsd: string;
  amountInUsd: string;
  timeEstimate: number;
  cashbackUsd: number;
}

interface Started {
  amount: string;
  symbol: string;
  chain: string;
  address: string;
  memo?: string | null;
  deadline?: string | null;
  trackHref: string;
  trackLabel: string;
}

const ZEC = "nep141:zec.omft.near";

function AssetSelect(props: { id: string; tokens: TokenOption[]; value: string; onChange: (v: string) => void; exclude?: string; label: string }) {
  return (
    <select id={props.id} className="select" aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      {props.tokens
        .filter((t) => t.assetId !== props.exclude)
        .map((t) => (
          <option key={t.assetId} value={t.assetId}>
            {tokenLabel(t)}
          </option>
        ))}
    </select>
  );
}

function CashbackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 54 A40 40 0 0 1 54 14" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" opacity=".55" />
      <circle cx="46" cy="46" r="9" fill="currentColor" />
    </svg>
  );
}

export function Composer() {
  const { tokens, config, error: loadError } = useTokens();
  const [mode, setMode] = useState<Mode>("ghost");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [cashback, setCashback] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<Started | null>(null);

  // Sensible defaults once the token list arrives: USDC on Base → SOL.
  useEffect(() => {
    if (!tokens.length || from) return;
    const pick = (sym: string, chain: string) => tokens.find((t) => t.symbol === sym && t.blockchain === chain)?.assetId;
    setFrom(pick("USDC", "base") ?? tokens[0].assetId);
    setTo(pick("SOL", "sol") ?? tokens[1]?.assetId ?? "");
  }, [tokens, from]);

  // Ghost Send can't deliver ZEC (a shielded swap is already private on arrival).
  useEffect(() => {
    if (mode === "ghost" && to === ZEC) setTo(tokens.find((t) => t.symbol === "SOL")?.assetId ?? "");
  }, [mode, to, tokens]);

  const fromT = useMemo(() => tokens.find((t) => t.assetId === from), [tokens, from]);
  const toT = useMemo(() => tokens.find((t) => t.assetId === to), [tokens, to]);
  const receiveTokens = mode === "ghost" ? tokens.filter((t) => t.assetId !== ZEC) : tokens;

  // Live price preview, debounced.
  useEffect(() => {
    setPreview(null);
    const n = Number(amount);
    if (!fromT || !toT || !(n > 0) || mode === "dca") return;
    const t = setTimeout(() => {
      setPreviewing(true);
      postJson<Preview>("/api/quote", { originAsset: from, destinationAsset: to, amount, dry: true })
        .then((p) => {
          setPreview(p);
          setError(null);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setPreviewing(false));
    }, 450);
    return () => clearTimeout(t);
  }, [amount, from, to, fromT, toT, mode]);

  const reset = () => {
    setStarted(null);
    setAmount("");
    setRecipient("");
    setPreview(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromT || !toT) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "ghost") {
        const r = await postJson<{ code: string; depositAddress: string; depositMemo: string | null; amountIn: string; deadline: string | null }>(
          "/api/ghost",
          { originAsset: from, destinationAsset: to, amount, recipient, refundTo, cashbackAddress: cashback || undefined },
        );
        setStarted({
          amount: r.amountIn,
          symbol: fromT.symbol,
          chain: chainName(fromT.blockchain),
          address: r.depositAddress,
          memo: r.depositMemo,
          deadline: r.deadline,
          trackHref: `/track?code=${r.code}`,
          trackLabel: `Track ${r.code}`,
        });
      } else {
        const r = await postJson<{ depositAddress: string; depositMemo: string | null; amountIn: string; deadline: string | null }>("/api/quote", {
          originAsset: from,
          destinationAsset: to,
          amount,
          recipient,
          refundTo,
          cashbackAddress: cashback || undefined,
          dry: false,
        });
        setStarted({
          amount: r.amountIn,
          symbol: fromT.symbol,
          chain: chainName(fromT.blockchain),
          address: r.depositAddress,
          memo: r.depositMemo,
          deadline: r.deadline,
          trackHref: `/track?code=${encodeURIComponent(r.depositAddress)}`,
          trackLabel: "Track this swap",
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      id={`tab-${m}`}
      aria-selected={mode === m}
      aria-controls="composer-panel"
      className="tab"
      onClick={() => {
        setMode(m);
        setError(null);
        setStarted(null);
      }}
    >
      {label}
    </button>
  );

  const cashbackRate = config ? `${(config.cashbackBps / 100).toFixed(2)}%` : "0.20%";

  return (
    <section className="composer" aria-label="Send">
      <div className="tabs" role="tablist" aria-label="What do you want to do">
        {tab("ghost", "Ghost Send")}
        {tab("swap", "Swap")}
        {tab("dca", "DCA")}
      </div>

      <div className="panel" id="composer-panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
        {loadError && <p className="notice notice--error">{loadError}</p>}

        {mode === "dca" ? (
          <>
            <p className="panel__intro">
              Buy ZEC on a schedule from USDC on Base. Each buy lands at your shielded address. Your USDC stays in your wallet until the day it's spent, and you
              can stop any time.
            </p>
            <Link href="/dca" className="btn btn--primary btn--block">
              Set up a plan
            </Link>
          </>
        ) : started ? (
          <DepositInstructions {...started} onReset={reset} />
        ) : (
          <form onSubmit={submit} className="panel" style={{ padding: 0 }}>
            <p className="panel__intro">
              {mode === "ghost"
                ? `Pay anyone on another chain. Your funds pass through shielded ZEC first, so the chain can't connect your wallet to theirs.`
                : `Swap between chains at the best route NEAR Intents can find. Send it to a u1 address to receive shielded ZEC.`}
            </p>

            <div className="field">
              <label className="field__label" htmlFor="amount">
                You send
              </label>
              <div className="amount">
                <input
                  id="amount"
                  className="input"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <AssetSelect id="from" label="Asset you send" tokens={tokens} value={from} onChange={setFrom} />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="to">
                {mode === "ghost" ? "They receive" : "You receive"}
              </label>
              <AssetSelect id="to" label="Asset received" tokens={receiveTokens} value={to} onChange={setTo} exclude={from} />
            </div>

            {(preview || previewing) && (
              <div className="receive" aria-live="polite">
                <span className="receive__amount">{preview ? `≈ ${preview.amountOut} ${toT?.symbol}` : "Finding a route…"}</span>
                {preview && (
                  <span className="receive__meta">
                    ${Number(preview.amountOutUsd).toFixed(2)}
                    <br />
                    {mode === "ghost"
                      ? `${config?.ghostMinDelayMin ?? 10}–${(config?.ghostMaxDelayMin ?? 90) + Math.ceil(preview.timeEstimate / 30)} min`
                      : `~${Math.max(1, Math.round(preview.timeEstimate / 60))} min`}
                  </span>
                )}
              </div>
            )}

            <div className="field">
              <label className="field__label" htmlFor="recipient">
                {mode === "ghost" ? `Their ${toT ? chainName(toT.blockchain) : ""} address` : `Your ${toT ? chainName(toT.blockchain) : ""} address`}
              </label>
              <input id="recipient" className="input input--mono" autoComplete="off" spellCheck={false} value={recipient} onChange={(e) => setRecipient(e.target.value)} required />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="refund">
                Refund address on {fromT ? chainName(fromT.blockchain) : "the sending chain"}
              </label>
              <input id="refund" className="input input--mono" autoComplete="off" spellCheck={false} value={refundTo} onChange={(e) => setRefundTo(e.target.value)} required />
              <span className="field__hint">If a route fails, your {fromT?.symbol ?? "funds"} come back here.</span>
            </div>

            <details className="more">
              <summary>Earn {cashbackRate} back in shielded ZEC</summary>
              <div className="stack">
                <div className="field">
                  <label className="field__label" htmlFor="cashback">
                    Your shielded Zcash address
                  </label>
                  <input
                    id="cashback"
                    className="input input--mono"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="u1…"
                    value={cashback}
                    onChange={(e) => setCashback(e.target.value)}
                  />
                  <span className="field__hint">
                    Starts with u1 or zs1.{mode === "ghost" ? " Use one that isn't connected to either wallet in this send." : ""}
                  </span>
                </div>
              </div>
            </details>

            {preview && cashback && (
              <div className="cashback-line">
                <CashbackIcon />
                You'll get <strong>${preview.cashbackUsd.toFixed(2)}</strong> back in ZEC
              </div>
            )}

            {error && <p className="notice notice--error" role="alert">{error}</p>}

            <button className="btn btn--primary btn--block" type="submit" disabled={busy || !preview}>
              {busy ? "Getting your deposit address…" : mode === "ghost" ? "Send privately" : "Get deposit address"}
            </button>
            {mode === "ghost" && config && (
              <span className="field__hint" style={{ textAlign: "center" }}>
                Up to ${config.ghostMaxUsd.toLocaleString()} per send. We erase the link between sender and recipient {config.ghostPurgeHours}h after delivery.
              </span>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
