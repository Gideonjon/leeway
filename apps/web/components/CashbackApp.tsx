"use client";
import { useEffect, useState } from "react";
import { SAMPLE_SHIELDED_ZEC, useNetwork } from "./network";
import { NetworkSwitch } from "./Shell";
import { fmtUsd, useTokens } from "./useTokens";

const isShielded = (a: string) => /^(u1[02-9ac-hj-np-z]{100,}|zs1[02-9ac-hj-np-z]{75})$/.test(a.trim());

export function CashbackApp() {
  const { tokens, config } = useTokens();
  const [net] = useNetwork();
  const isTestnet = net === "testnet";
  const [addr, setAddr] = useState("");
  const [data, setData] = useState<{ pendingZat: string; paidZat: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const price = tokens.find((t) => t.assetId === "nep141:zec.omft.near")?.price ?? 0;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("leeway.cashback") ?? "";
      setAddr(saved);
      if (isShielded(saved)) void check(saved);
    } catch {}
  }, []);

  async function check(a = addr) {
    setError(null);
    const r = await fetch(`/api/cashback?address=${encodeURIComponent(a.trim())}`);
    const d = await r.json();
    if (!r.ok) {
      setData(null);
      setError(d.error);
    } else {
      setData(d);
      try {
        localStorage.setItem("leeway.cashback", a.trim());
      } catch {}
    }
  }

  const zec = (z: string) => Number(z) / 1e8;
  const rate = config ? (config.cashbackBps / 100).toFixed(2) : "0.20";

  return (
    <main className="stage stage--split">
      <section className="widget" aria-label="Cashback">
        <header className="widget__head">
          <div className="widget__head-top">
            <h1>Cashback</h1>
            <div className="widget__head-actions">
              {isTestnet && (
                <button
                  type="button"
                  className="chip-btn chip-btn--sm"
                  onClick={() => {
                    setAddr(SAMPLE_SHIELDED_ZEC);
                    void check(SAMPLE_SHIELDED_ZEC);
                  }}
                >
                  Check test ZEC address
                </button>
              )}
              <NetworkSwitch compact />
            </div>
          </div>
          <p>{rate}% of every swap comes back to you in shielded ZEC. Your shielded address is the only thing that tracks it.</p>
        </header>
        <form
          className="widget__body"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <div className="opts">
            <label className="opt">
              <span className="opt__label">Your address</span>
              <input className="opt__input" placeholder="u1…" value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} autoComplete="off" />
            </label>
          </div>
          {error && (
            <p className="note note--error" role="alert">
              {error}
            </p>
          )}
          <button className="cta" type="submit" disabled={!isShielded(addr)}>
            {isShielded(addr) ? "Check my cashback" : "Paste a shielded address"}
          </button>

          {data && (
            <div className="earn">
              <div className="earn__cell earn__cell--main">
                <span className="tcard__label">Paid to you</span>
                <span className="earn__big">{zec(data.paidZat).toLocaleString(undefined, { maximumFractionDigits: 5 })} ZEC</span>
                <span className="earn__usd">{price ? fmtUsd(zec(data.paidZat) * price) : ""}</span>
              </div>
              <div className="earn__cell">
                <span className="tcard__label">On its way</span>
                <span className="earn__mid">{zec(data.pendingZat).toLocaleString(undefined, { maximumFractionDigits: 5 })} ZEC</span>
                <span className="earn__usd">{price ? fmtUsd(zec(data.pendingZat) * price) : ""}</span>
              </div>
            </div>
          )}
        </form>
      </section>

      <section className="passage-panel" aria-label="How cashback works">
        <header className="passage-panel__head">
          <h2>Where it comes from</h2>
          <p>Paid once a day in a single shielded transaction.</p>
        </header>
        <div className="split-bar" aria-hidden="true">
          <span className="split-bar__keep" style={{ flex: (config?.appFeeBps ?? 50) - (config?.cashbackBps ?? 20) }} />
          <span className="split-bar__back" style={{ flex: config?.cashbackBps ?? 20 }} />
        </div>
        <dl className="costs">
          <div>
            <dt>Leeway fee on each swap</dt>
            <dd>{config ? (config.appFeeBps / 100).toFixed(2) : "0.50"}%</dd>
          </div>
          <div className="costs__back">
            <dt>Back to you</dt>
            <dd>{rate}%</dd>
          </div>
          <div>
            <dt>Paid in</dt>
            <dd>Shielded ZEC</dd>
          </div>
          <div>
            <dt>Ghost Send and Swap</dt>
            <dd>After delivery</dd>
          </div>
          <div>
            <dt>DCA</dt>
            <dd>On the 1st of each month</dd>
          </div>
        </dl>
        <p className="panel-note">
          Payouts go out in one shielded transaction to everyone owed, so nobody can see who earned what. Balances under 0.001 ZEC roll over to the next payout.
        </p>
      </section>
    </main>
  );
}
