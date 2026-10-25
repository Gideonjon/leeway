"use client";
import Link from "next/link";
import { useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** What to pay, where, and the handle to track it. */
export function DepositInstructions(props: {
  amount: string;
  symbol: string;
  chain: string;
  address: string;
  memo?: string | null;
  deadline?: string | null;
  trackHref: string;
  trackLabel: string;
  onReset: () => void;
}) {
  const deadline = props.deadline ? new Date(props.deadline) : null;
  return (
    <div className="deposit" aria-live="polite">
      <span className="pill pill--waiting">Awaiting deposit</span>
      <div>
        <div className="field__label">Send exactly</div>
        <div className="deposit__amount">
          {props.amount} {props.symbol}
        </div>
        <div className="field__hint">on {props.chain}, from a wallet whose refunds reach the address you gave.</div>
      </div>
      <div className="field">
        <span className="field__label">To this deposit address</span>
        <div className="deposit__addr">
          <code>{props.address}</code>
          <CopyButton value={props.address} />
        </div>
      </div>
      {props.memo && (
        <div className="field">
          <span className="field__label">With this memo (required)</span>
          <div className="deposit__addr">
            <code>{props.memo}</code>
            <CopyButton value={props.memo} />
          </div>
        </div>
      )}
      {deadline && (
        <p className="notice">
          Pay before {deadline.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Anything after that is refunded.
        </p>
      )}
      <Link className="btn btn--secondary btn--block" href={props.trackHref}>
        {props.trackLabel}
      </Link>
      <button type="button" className="btn btn--secondary btn--block" onClick={props.onReset} style={{ border: 0 }}>
        Start another
      </button>
    </div>
  );
}
