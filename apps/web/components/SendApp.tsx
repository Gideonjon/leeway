"use client";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { addressHint, chainName, isEvmChain, shortAddr } from "@/lib/chains";
import { paymentUri } from "@/lib/payuri";
import { WalletModal } from "./WalletModal";
import { addActivity } from "./activity";
import { phaseOf } from "./ActivityDrawer";
import { SAMPLE_SHIELDED_ZEC, sampleAddressForChain, useNetwork } from "./network";
import { PassagePanel, type Preview } from "./Passage";
import { NetworkSwitch } from "./Shell";
import { TokenIcon } from "./TokenIcon";
import { TokenPicker } from "./TokenPicker";
import { fmtBalance, useBalances } from "./useBalances";
import { fmtAmount, fmtUsd, postJson, useTokens, type TokenOption } from "./useTokens";
import { useWallet } from "./Wallet";

type Mode = "ghost" | "swap";
const ZEC = "nep141:zec.omft.near";

interface Started {
  id: string;
  depositAddress: string;
  depositMemo: string | null;
  amountIn: string;
  deadline: string | null;
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function TokenButton({ token, onClick, label, locked }: { token?: TokenOption; onClick: () => void; label: string; locked?: boolean }) {
  if (locked && token) {
    return (
      <span className="tok-btn tok-btn--static" aria-label={label}>
        <TokenIcon symbol={token.symbol} chain={token.blockchain} size={36} />
        <span className="tok-btn__text">
          <strong>{token.symbol}</strong>
          <span>{chainName(token.blockchain)}</span>
        </span>
      </span>
    );
  }
  return (
    <button type="button" className="tok-btn" onClick={onClick} aria-label={label}>
      {token ? (
        <>
          <TokenIcon symbol={token.symbol} chain={token.blockchain} size={36} />
          <span className="tok-btn__text">
            <strong>{token.symbol}</strong>
            <span>{chainName(token.blockchain)}</span>
          </span>
        </>
      ) : (
        <span className="tok-btn__text">
          <strong>Select</strong>
        </span>
      )}
      <Chevron />
    </button>
  );
}

function Qr({ value }: { value: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    void QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0D1315", light: "#FFFFFF" } }).then(setSvg);
  }, [value]);
  return <div className="qr" role="img" aria-label="QR code of the deposit address" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Copy({ value, children }: { value: string; children?: React.ReactNode }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={() =>
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? "Copied" : (children ?? "Copy")}
    </button>
  );
}

function useCountdown(deadline: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SendApp({ mode }: { mode: Mode }) {
  const { tokens, config, error: loadError } = useTokens();
  const wallet = useWallet();
  const { balanceOf, isChainConnected } = useBalances(tokens);
  const [net] = useNetwork();
  const isTestnet = net === "testnet";
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [refundEdited, setRefundEdited] = useState(false);
  const [cashOn, setCashOn] = useState(true);
  const [cashback, setCashback] = useState("");
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<Started | null>(null);
  const [live, setLive] = useState<{ type: string; state?: string; status?: string; releaseAt?: string | null; review?: boolean } | null>(null);
  const [paidTx, setPaidTx] = useState<string | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);

  // Remember the user's cashback address on this device.
  useEffect(() => {
    try {
      setCashback(localStorage.getItem("leeway.cashback") ?? "");
    } catch {}
  }, []);

  const from = tokens.find((t) => t.assetId === fromId);
  const to = tokens.find((t) => t.assetId === toId);
  const fromBalance = balanceOf(from);
  const toBalance = balanceOf(to);
  const fromConnected = isChainConnected(from);
  const toConnected = isChainConnected(to);

  useEffect(() => {
    if (!tokens.length || fromId) return;
    const pick = (s: string, c: string) => tokens.find((t) => t.symbol === s && t.blockchain === c)?.assetId;
    setFromId(pick("USDC", "base") ?? tokens[0].assetId);
    setToId(mode === "ghost" ? (pick("SOL", "sol") ?? tokens[1].assetId) : (tokens.find((t) => t.assetId === ZEC)?.assetId ?? tokens[1].assetId));
  }, [tokens, fromId, mode]);

  useEffect(() => {
    if (mode === "ghost" && toId === ZEC) setToId(tokens.find((t) => t.symbol === "SOL")?.assetId ?? "");
    if (mode === "swap" && toId && toId !== ZEC && fromId !== ZEC) setToId(ZEC);
  }, [mode, toId, fromId, tokens]);

  // Pre-fill the refund address from the connected wallet when the sending chain is connected.
  useEffect(() => {
    if (refundEdited) return;
    setRefundTo(from ? (wallet.addressFor(from.blockchain) ?? "") : "");
  }, [wallet, from, refundEdited]);

  // Live quote, debounced; refreshed every 30s while idle.
  const reqId = useRef(0);
  useEffect(() => {
    if (started) return; // keep the locked route on screen while tracking
    setPreview(null);
    setError(null);
    const n = Number(amount);
    if (!from || !to || !(n > 0)) return;
    const run = () => {
      const id = ++reqId.current;
      setQuoting(true);
      postJson<Preview>("/api/quote", { originAsset: from.assetId, destinationAsset: to.assetId, amount, dry: true })
        .then((p) => id === reqId.current && setPreview(p))
        .catch((e: Error) => id === reqId.current && setError(e.message))
        .finally(() => id === reqId.current && setQuoting(false));
    };
    const t = setTimeout(run, 400);
    const r = setInterval(run, 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(r);
    };
  }, [amount, from, to, started]);

  // Live tracking after start — poll every 2.5s so steps reflect in real time.
  useEffect(() => {
    if (!started) return;
    let on = true;
    const load = () =>
      fetch(`/api/track/${encodeURIComponent(started.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => on && d && setLive(d));
    void load();
    const t = setInterval(load, 2500);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [started]);

  const countdown = useCountdown(started?.deadline ?? null);
  const usdIn = from && Number(amount) > 0 ? Number(amount) * from.price : 0;
  const overCap = mode === "ghost" && config && usdIn > config.ghostMaxUsd;
  const recipientHint = to ? addressHint(to.blockchain, recipient) : null;
  const refundHint = from ? addressHint(from.blockchain, refundTo) : null;
  const cashbackValid = !cashOn || !cashback || /^(u1[02-9ac-hj-np-z]{100,}|zs1[02-9ac-hj-np-z]{75})$/.test(cashback.trim());

  const ready = Boolean(preview && recipient.trim() && refundTo.trim() && !recipientHint && !refundHint && cashbackValid && !overCap);
  const cta = !from || !to
    ? "Choose tokens"
    : !(Number(amount) > 0)
      ? "Enter an amount"
      : overCap
        ? `Ghost Send is capped at ${fmtUsd(config!.ghostMaxUsd)}`
        : quoting && !preview
          ? "Finding the best route…"
          : !recipient.trim()
            ? mode === "ghost"
              ? "Add their address"
              : "Add your receiving address"
            : recipientHint
              ? mode === "ghost"
                ? "Check their address"
                : "Check your receiving address"
              : !refundTo.trim()
                ? "Add a refund address"
                : refundHint
                  ? "Check your refund address"
                  : !cashbackValid
                    ? "Check your cashback address"
              : mode === "ghost"
                ? "Send privately"
                : "Swap";

  const liveStep = useMemo(() => {
    if (!started) return busy ? 0 : undefined;
    if (!live) return paidTx ? 1 : 0;
    if (live.type === "ghost") {
      const mapped = ({ awaiting_deposit: 0, shielding: 1, holding: 2, sending_leg2: 3, leg2_pending: 3, completed: 5 } as Record<string, number>)[live.state ?? ""] ?? 0;
      if (mapped === 0 && paidTx) return 1;
      return mapped;
    }
    const mapped = ({ PENDING_DEPOSIT: 0, KNOWN_DEPOSIT_TX: 1, PROCESSING: 1, SUCCESS: 3, REFUNDED: 0, FAILED: 0 } as Record<string, number>)[live.status ?? ""] ?? 1;
    if (mapped === 0 && paidTx) return 1;
    return mapped;
  }, [started, live, paidTx, busy]);

  const holdLeft = live?.releaseAt ? Math.max(1, Math.ceil((new Date(live.releaseAt).getTime() - Date.now()) / 60_000)) : null;
  const livePhase = phaseOf(live);

  const inlineStepList = useMemo(() => {
    if (mode === "ghost") {
      return [
        { key: "deposit", label: `1. Deposit ${from?.symbol ?? ""}` },
        { key: "leg1", label: "2. Convert & shield to ZEC" },
        { key: "hold", label: "3. Orchard pool hold" },
        { key: "leg2", label: `4. Route out to ${to?.symbol ?? ""}` },
        { key: "arrive", label: "5. Delivered privately" },
      ];
    }
    return [
      { key: "deposit", label: `1. Deposit ${from?.symbol ?? ""}` },
      { key: "swap", label: "2. NEAR Intents solver fill" },
      { key: "arrive", label: `3. Receive ${to?.symbol ?? ""}` },
    ];
  }, [mode, from?.symbol, to?.symbol]);

  async function start() {
    if (!from || !to || !ready) return;
    setBusy(mode === "ghost" ? "Opening the passage…" : "Locking your route…");
    setError(null);
    const cb = cashOn && cashback.trim() ? cashback.trim() : undefined;
    try {
      if (cb) localStorage.setItem("leeway.cashback", cb);
    } catch {}
    try {
      const body = { originAsset: from.assetId, destinationAsset: to.assetId, amount, recipient: recipient.trim(), refundTo: refundTo.trim(), cashbackAddress: cb };
      const r = isTestnet
        ? mode === "ghost"
          ? await postJson<Started & { code: string }>("/api/testnet", { ...body, action: "ghost" }).then((x) => ({ ...x, id: x.code }))
          : await postJson<Started>("/api/testnet", { ...body, action: "quote" }).then((x) => ({ ...x, id: x.depositAddress }))
        : mode === "ghost"
          ? await postJson<Started & { code: string }>("/api/ghost", body).then((x) => ({ ...x, id: x.code }))
          : await postJson<Started>("/api/quote", { ...body, dry: false }).then((x) => ({ ...x, id: x.depositAddress }));
      setStarted(r);
      addActivity({
        id: r.id,
        kind: mode,
        fromSymbol: from.symbol,
        fromChain: from.blockchain,
        toSymbol: to.symbol,
        toChain: to.blockchain,
        amount: r.amountIn,
        createdAt: Date.now(),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function refreshTrack(id: string) {
    const r = await fetch(`/api/track/${encodeURIComponent(id)}`);
    if (r.ok) {
      const d = await r.json();
      setLive(d);
      return d;
    }
    return null;
  }

  async function simulateTestnet(step?: "auto" | "complete") {
    if (!started) return;
    setError(null);
    try {
      if (mode === "swap") {
        setBusy("Step 1/3: Broadcasting deposit on-chain…");
        setPaidTx(`0xtestnet_${Date.now().toString(16)}`);
        await sleep(900);
        setBusy("Step 2/3: NEAR Intents solvers filling swap…");
        await postJson("/api/testnet", { action: "simulate", id: started.id, kind: "swap", step: "processing" });
        await refreshTrack(started.id);
        await sleep(1400);
        setBusy("Step 3/3: Finalizing delivery…");
        await postJson("/api/testnet", { action: "simulate", id: started.id, kind: "swap", step: "complete" });
        await refreshTrack(started.id);
        return;
      }

      if (step === "complete") {
        setBusy("Step 4/5: Leaving Orchard pool via fresh address…");
        await postJson("/api/testnet", { action: "simulate", id: started.id, kind: "ghost", step: "sending_leg2" });
        await refreshTrack(started.id);
        await sleep(1500);
        setBusy("Step 5/5: Confirming private delivery…");
        await postJson("/api/testnet", { action: "simulate", id: started.id, kind: "ghost", step: "complete" });
        await refreshTrack(started.id);
        return;
      }

      // Full step-by-step Ghost Send progression: Deposit -> Leg 1 (Shielding) -> Orchard Hold
      setBusy("Step 1/5: Confirming deposit…");
      setPaidTx(`0xtestnet_${Date.now().toString(16)}`);
      await sleep(900);

      setBusy("Step 2/5: Converting into ZEC & shielding into Orchard…");
      await postJson("/api/testnet", { action: "simulate", id: started.id, kind: "ghost", step: "shielding" });
      await refreshTrack(started.id);
      await sleep(1500);

      setBusy("Step 3/5: Entering Zcash Orchard shielded pool…");
      await postJson("/api/testnet", { action: "simulate", id: started.id, kind: "ghost", step: "holding" });
      await refreshTrack(started.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function fillTestAddresses() {
    if (!amount || !(Number(amount) > 0)) setAmount("25");
    if (to) setRecipient(sampleAddressForChain(to.blockchain));
    if (from) {
      setRefundEdited(true);
      setRefundTo(sampleAddressForChain(from.blockchain));
    }
    if (cashOn && !cashback) setCashback(SAMPLE_SHIELDED_ZEC);
  }

  async function payWithWallet() {
    if (!started || !from) return;
    if (!payer) {
      setWalletOpen(true);
      return;
    }
    setError(null);
    setBusy("Step 1: Confirm deposit in your wallet…");
    try {
      const hash = await wallet.pay({ chain: from.blockchain, to: started.depositAddress, amount: started.amountIn, decimals: from.decimals, contract: from.contractAddress });
      setPaidTx(hash);
      setBusy("Step 2: Broadcasting deposit to network & notifying solvers…");
      await postJson("/api/deposit", { txHash: hash, depositAddress: started.depositAddress }).catch(() => undefined);
      await refreshTrack(started.id);
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setStarted(null);
    setLive(null);
    setPaidTx(null);
    setAmount("");
    setRecipient("");
  }

  const flip = () => {
    if (mode === "ghost" && fromId === ZEC) return;
    setFromId(toId);
    setToId(fromId);
    setRefundEdited(false);
  };

  const showPanel = Boolean(from && to);
  const payChain = from?.blockchain ?? "";
  const canWalletPay = Boolean(from && (isEvmChain(payChain) || payChain === "sol") && wallet.canPay(payChain) && !started?.depositMemo);
  const payer = from ? wallet.addressFor(payChain) : null;
  const payUri = started && from ? paymentUri(payChain, started.depositAddress, started.amountIn, { mint: from.contractAddress }) : null;
  const activeStepIdx = liveStep ?? -1;

  return (
    <main className={`stage ${showPanel ? "stage--split" : ""}`}>
      <section className="widget" aria-label={mode === "ghost" ? "Ghost Send" : "Swap"}>
        <header className="widget__head">
          <div className="widget__head-top">
            <h1>{mode === "ghost" ? "Ghost Send" : "Swap"}</h1>
            <div className="widget__head-actions">
              {isTestnet && !started && (
                <button type="button" className="chip-btn chip-btn--sm" onClick={fillTestAddresses}>
                  Fill test addresses
                </button>
              )}
              <NetworkSwitch compact />
            </div>
          </div>
          <p>{mode === "ghost" ? "Pay anyone on any chain. The chain can't link your wallet to theirs." : "Any token, any chain. Send to a u1 address to receive shielded ZEC."}</p>
        </header>

        {loadError && <p className="note note--error">{loadError}</p>}

        {!started ? (
          <form
            className="widget__body"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <div className="tcard">
              <div className="tcard__row">
                <span className="tcard__label">You send</span>
                {from && (
                  <span className="tcard__meta tcard__meta--bal">
                    <span>
                      Balance: <strong>{fmtBalance(fromBalance)}</strong> {from.symbol}
                    </span>
                    {fromBalance > 0 && (
                      <button
                        type="button"
                        className="bal-max"
                        onClick={() => setAmount(String(fromBalance))}
                        title="Use maximum balance"
                      >
                        Max
                      </button>
                    )}
                    {!fromConnected && <span className="bal-tag">Wallet not connected</span>}
                  </span>
                )}
              </div>
              <div className="tcard__main">
                <TokenButton
                  token={from}
                  locked={mode === "swap" && from?.assetId === ZEC}
                  onClick={() => setPicker("from")}
                  label="Choose the token you send"
                />
                <input
                  className="tcard__amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  aria-label="Amount you send"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value.replace(",", ".").replace(/[^\d.]/g, "");
                    if ((v.match(/\./g) ?? []).length <= 1) setAmount(v);
                  }}
                />
              </div>
              <div className="tcard__row tcard__row--foot">
                <span>{usdIn ? fmtUsd(usdIn) : " "}</span>
                {mode === "ghost" && config && <span className={overCap ? "warn" : ""}>Max {fmtUsd(config.ghostMaxUsd)}</span>}
              </div>
            </div>

            <div className="flip-wrap">
              <button type="button" className="flip" onClick={flip} aria-label="Swap direction">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
                </svg>
              </button>
            </div>

            <div className="tcard tcard--to">
              <div className="tcard__row">
                <span className="tcard__label">{mode === "ghost" ? "They receive" : "You receive"}</span>
                {to && (
                  <span className="tcard__meta tcard__meta--bal">
                    {mode === "swap" ? (
                      <span>
                        Balance: <strong>{fmtBalance(toBalance)}</strong> {to.symbol}
                        {!toConnected ? "" : ""}
                      </span>
                    ) : (
                      <span>on {chainName(to.blockchain)}</span>
                    )}
                  </span>
                )}
              </div>
              <div className="tcard__main">
                <TokenButton
                  token={to}
                  locked={mode === "swap" && to?.assetId === ZEC}
                  onClick={() => setPicker("to")}
                  label="Choose the token received"
                />
                <output className={`tcard__amount tcard__amount--out ${quoting ? "is-quoting" : ""}`} aria-live="polite">
                  {preview ? fmtAmount(preview.amountOut) : quoting ? "…" : "0"}
                </output>
              </div>
              <div className="tcard__row tcard__row--foot">
                <span>{preview ? fmtUsd(Number(preview.amountOutUsd)) : " "}</span>
              </div>
              <label className="addr">
                <span className="sr-only">{mode === "ghost" ? "Their address" : "Your receiving address"}</span>
                <input
                  className="addr__input"
                  placeholder={to ? `${mode === "ghost" ? "Their" : "Your"} ${chainName(to.blockchain)} address` : "Receiving address"}
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                {mode === "swap" && to && wallet.addressFor(to.blockchain) && !recipient && (
                  <button type="button" className="addr__fill" onClick={() => setRecipient(wallet.addressFor(to.blockchain)!)}>
                    Use mine
                  </button>
                )}
              </label>
              {recipientHint && <p className="hint hint--error">{recipientHint}</p>}
            </div>

            <div className="opts">
              <label className="opt">
                <span className="opt__label">Refunds to</span>
                <input
                  className="opt__input"
                  placeholder={from ? `Your ${chainName(from.blockchain)} address` : "Refund address"}
                  value={refundTo}
                  onChange={(e) => {
                    setRefundEdited(true);
                    setRefundTo(e.target.value);
                  }}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              {refundHint && <p className="hint hint--error">{refundHint}</p>}

              <div className={`opt opt--cash ${cashOn ? "is-on" : ""}`}>
                <button type="button" className="switch" role="switch" aria-checked={cashOn} onClick={() => setCashOn((v) => !v)}>
                  <span className="sr-only">Cashback</span>
                </button>
                <span className="opt__label">
                  Cashback <b>{config ? `${(config.cashbackBps / 100).toFixed(2)}%` : "0.20%"}</b>
                </span>
                {preview && cashOn && <span className="opt__value">+{fmtUsd(preview.cashbackUsd)}</span>}
                {cashOn && (
                  <input
                    className="opt__input"
                    placeholder="Your shielded address, u1…"
                    value={cashback}
                    onChange={(e) => setCashback(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Shielded Zcash address for cashback"
                  />
                )}
              </div>
              {!cashbackValid && <p className="hint hint--error">Cashback goes to a shielded Zcash address, starting with u1 or zs1.</p>}
              {cashOn && cashbackValid && mode === "ghost" && cashback && <p className="hint">Use an address that isn&apos;t linked to either wallet in this send.</p>}
            </div>

            {error && (
              <p className="note note--error" role="alert">
                {error}
              </p>
            )}

            <button className="cta" type="submit" disabled={!ready || Boolean(busy)}>
              {busy ?? cta}
            </button>
          </form>
        ) : (
          <div className="widget__body deposit">
            <div className="deposit__top">
              <span className={`pill pill--${busy ? "moving" : livePhase.phase}`}>
                {busy ?? (live ? livePhase.label : paidTx ? "Deposit broadcast" : "Awaiting deposit")}
              </span>
              {countdown && activeStepIdx === 0 && !paidTx && (
                <span className="deposit__timer">{countdown === "expired" ? "Quote expired" : `Pay within ${countdown}`}</span>
              )}
            </div>

            {/* Live inline transaction progress strip inside the active widget */}
            <div className="tx-progress" aria-label="Live transaction progress">
              {inlineStepList.map((s, idx) => {
                const isDone = activeStepIdx > idx || activeStepIdx >= inlineStepList.length;
                const isNow = activeStepIdx === idx && activeStepIdx < inlineStepList.length;
                return (
                  <div key={s.key} className={`tx-progress__step ${isDone ? "is-done" : isNow ? "is-now" : "is-todo"}`}>
                    <span className="tx-progress__dot">{isDone ? "✓" : idx + 1}</span>
                    <span className="tx-progress__label">{s.label}</span>
                  </div>
                );
              })}
            </div>

            {activeStepIdx === 0 ? (
              <>
                <div className="deposit__amount">
                  <TokenIcon symbol={from!.symbol} chain={from!.blockchain} size={44} />
                  <div>
                    <div className="deposit__big">
                      {fmtAmount(started.amountIn)} {from!.symbol}
                    </div>
                    <div className="deposit__sub">Send exactly this on {chainName(from!.blockchain)}</div>
                  </div>
                </div>

                {started.depositAddress.startsWith("testnet_") ? (
                  <button className="cta" onClick={() => void simulateTestnet("auto")} disabled={Boolean(busy)}>
                    {busy ?? "Simulate Testnet Deposit"}
                  </button>
                ) : (
                  <>
                    {canWalletPay && !paidTx && (
                      <button className="cta" onClick={() => void payWithWallet()} disabled={Boolean(busy)}>
                        {busy ?? (payer ? `Pay with ${shortAddr(payer, 5, 4)}` : `Connect a ${chainName(payChain)} wallet to pay`)}
                      </button>
                    )}
                    {payUri && !canWalletPay && (
                      <a className="cta cta--link" href={payUri}>
                        {payChain === "zec" ? "Open in Zcash wallet" : `Open in ${chainName(payChain)} wallet`}
                      </a>
                    )}
                  </>
                )}
                {payChain === "zec" && <p className="hint">Works with Noir, Zodl, Zingo, YWallet and Cake. On a phone, scan the QR from your wallet.</p>}
                {paidTx && <p className="note">Sent from your wallet. It starts as soon as the deposit confirms.</p>}

                <div className="deposit__addr">
                  <Qr value={payUri ?? started.depositAddress} />
                  <div className="deposit__addr-text">
                    <span className="tcard__label">{canWalletPay ? "Or send it yourself to" : "Deposit address"}</span>
                    <code>{started.depositAddress}</code>
                    <Copy value={started.depositAddress}>Copy address</Copy>
                    {started.depositMemo && (
                      <>
                        <span className="tcard__label">Memo, required</span>
                        <code>{started.depositMemo}</code>
                        <Copy value={started.depositMemo}>Copy memo</Copy>
                      </>
                    )}
                  </div>
                </div>
                <p className="hint">Anything sent after the timer runs out is refunded to {shortAddr(refundTo, 6, 4)}.</p>
              </>
            ) : live?.review ? (
              <p className="note">
                Leeway paused this transfer to check it by hand before anything else moves. Your funds are safe in the Leeway wallet. Keep your tracking code; the team
                resolves these within a day.
              </p>
            ) : livePhase.phase === "failed" ? (
              <p className="note note--error">{live?.state === "refunded" || live?.status === "REFUNDED" ? "The route was refunded to your address. Nothing was lost." : "This transfer stopped. Contact support with your tracking code."}</p>
            ) : livePhase.phase === "settled" ? (
              <div className="done">
                <div className="done__mark" aria-hidden="true">
                  <svg viewBox="0 0 64 64" width="56" height="56">
                    <path d="M14 54 A40 40 0 0 1 54 14" fill="none" stroke="var(--lee)" strokeWidth="9" strokeLinecap="round" />
                    <circle cx="46" cy="46" r="8" fill="var(--lantern)" />
                  </svg>
                </div>
                <div className="deposit__big">Delivered</div>
                <p className="deposit__sub">
                  {mode === "ghost" ? "It's in their wallet, and nothing on-chain connects it to yours." : "It's in your wallet."}
                </p>
              </div>
            ) : mode === "ghost" && activeStepIdx === 2 ? (
              <>
                <div className="hold">
                  <svg className="hold__mark" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
                    <path d="M14 54 A40 40 0 0 1 54 14" fill="none" stroke="var(--lee)" strokeWidth="9" strokeLinecap="round" />
                    <circle cx="46" cy="46" r="8" fill="var(--lantern)" />
                  </svg>
                  <div>
                    <div className="hold__label">Held in the shielded pool</div>
                    <div className="hold__time">{holdLeft ? `${holdLeft} min` : "Any moment"}</div>
                    <div className="hold__sub">until leg two leaves. Amount and owner are hidden while it waits.</div>
                  </div>
                </div>
                {started.depositAddress.startsWith("testnet_") && (
                  <button className="cta" onClick={() => void simulateTestnet("complete")} disabled={Boolean(busy)}>
                    {busy ?? "Fast-forward hold & deliver (Testnet)"}
                  </button>
                )}
              </>
            ) : (
              <p className="note">
                {busy
                  ? busy
                  : mode === "ghost"
                    ? activeStepIdx >= 3
                      ? "Leg two is on its way out. It lands from a fresh address with no trail back to you."
                      : "Deposit received. Solvers are converting it into ZEC and shielding into Orchard."
                    : "Deposit received. Solvers on NEAR Intents are filling your swap."}
              </p>
            )}

            <div className="deposit__code">
              <span className="tcard__label">{mode === "ghost" ? "Tracking code" : "Swap ID"}</span>
              <code>{mode === "ghost" ? started.id : shortAddr(started.id, 10, 6)}</code>
              <Copy value={started.id} />
            </div>

            {error && (
              <p className="note note--error" role="alert">
                {error}
              </p>
            )}

            <button className="cta cta--quiet" onClick={reset}>
              {livePhase.phase === "settled" ? "Send another" : "Start a new one"}
            </button>
          </div>
        )}
      </section>

      {showPanel && from && to && (
        <PassagePanel
          mode={mode}
          from={from}
          to={to}
          amountInput={started ? started.amountIn : amount}
          preview={started && preview ? { ...preview, amountIn: started.amountIn } : preview}
          config={config}
          liveStep={liveStep}
          holdMinutesLeft={holdLeft}
          statusHint={busy}
          paidTx={paidTx}
        />
      )}

      {walletOpen && <WalletModal onClose={() => setWalletOpen(false)} />}

      {picker && (
        <TokenPicker
          title={picker === "from" ? "You send" : mode === "ghost" ? "They receive" : "You receive"}
          tokens={picker === "to" && mode === "ghost" ? tokens.filter((t) => t.assetId !== ZEC) : tokens}
          exclude={picker === "from" ? toId : fromId}
          onClose={() => setPicker(null)}
          onPick={(t) => {
            if (picker === "from") {
              setFromId(t.assetId);
              setRefundEdited(false);
            } else setToId(t.assetId);
            setPicker(null);
          }}
        />
      )}
    </main>
  );
}
