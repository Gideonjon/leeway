"use client";
import { chainName } from "@/lib/chains";
import { TokenIcon } from "./TokenIcon";
import { fmtAmount, fmtUsd, type PublicConfig, type TokenOption } from "./useTokens";
import type { Phase } from "./ActivityDrawer";

export interface Preview {
  amountIn: string;
  amountOut: string;
  amountOutUsd: string;
  amountInUsd: string;
  timeEstimate: number;
  cashbackUsd: number;
}

type StepState = "todo" | "now" | "done";

function liveTitle(step: number | undefined, mode: "ghost" | "swap", statusHint?: string | null) {
  if (statusHint) return statusHint;
  if (step === undefined) return mode === "ghost" ? "The passage" : "Route";
  const last = mode === "ghost" ? 5 : 3;
  if (step >= last) return "Delivered";
  if (step === 0) return "Step 1 — Deposit";
  if (mode === "ghost") {
    if (step === 1) return "Step 2 — Converting into ZEC";
    if (step === 2) return "Step 3 — Held in shielded pool";
    if (step === 3 || step === 4) return "Step 4 — Leaving to destination";
  } else if (step === 1 || step === 2) {
    return "Step 2 — Filling cross-chain swap";
  }
  return "On its way";
}

function Step(props: {
  state: StepState;
  stepNum: number;
  shielded?: boolean;
  title: React.ReactNode;
  detail: React.ReactNode;
  aside?: React.ReactNode;
  icon: React.ReactNode;
}) {
  const badge =
    props.state === "done" ? (
      <span className="pstep__badge pstep__badge--done">Done</span>
    ) : props.state === "now" ? (
      <span className="pstep__badge pstep__badge--now">
        <span className="pstep__pulse" />
        Active
      </span>
    ) : null;

  return (
    <li className={`pstep pstep--${props.state} ${props.shielded ? "pstep--shielded" : ""}`}>
      <span className="pstep__icon">{props.icon}</span>
      <div className="pstep__body">
        <div className="pstep__title-row">
          <span className="pstep__title">{props.title}</span>
          {badge}
        </div>
        <div className="pstep__detail">{props.detail}</div>
      </div>
      {props.aside && <div className="pstep__aside">{props.aside}</div>}
    </li>
  );
}

function ShieldGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 54 A40 40 0 0 1 54 14" fill="none" stroke="var(--lee)" strokeWidth="11" strokeLinecap="round" />
      <circle cx="46" cy="46" r="8" fill="var(--lantern)" />
    </svg>
  );
}

/**
 * The route, drawn as the passage it is. With `liveStep`, it doubles as the live real-time transaction tracker.
 */
export function PassagePanel(props: {
  mode: "ghost" | "swap";
  from: TokenOption;
  to: TokenOption;
  amountInput?: string;
  preview: Preview | null;
  config: PublicConfig | null;
  phase?: Phase;
  /** Index of the live step while tracking; order.length when delivered. */
  liveStep?: number;
  holdMinutesLeft?: number | null;
  statusHint?: string | null;
  paidTx?: string | null;
}) {
  const { from, to, preview, config, mode, amountInput, statusHint, paidTx } = props;
  const zec = { symbol: "ZEC", chain: "zec" };
  const rawIn = preview?.amountIn ?? (Number(amountInput) > 0 ? String(amountInput) : "0");
  const inUsd = preview ? Number(preview.amountInUsd) : Number(rawIn) * from.price;
  const feeShare = config ? config.appFeeBps / 10_000 : 0.004;
  const estOutUsd = preview ? Number(preview.amountOutUsd) : inUsd > 0 ? inUsd * (1 - feeShare) : 0;
  const estOutAmt = preview ? preview.amountOut : estOutUsd > 0 && to.price > 0 ? String(estOutUsd / to.price) : "0";
  const feeUsd = config ? (inUsd * config.appFeeBps) / 10_000 : inUsd * 0.004;
  const routeUsd = preview ? Math.max(0, inUsd - estOutUsd - feeUsd) : 0;
  const cashbackUsd = preview ? preview.cashbackUsd : config ? (inUsd * config.cashbackBps) / 10_000 : inUsd * 0.002;
  const minHold = config?.ghostMinDelayMin ?? 10;
  const maxHold = config?.ghostMaxDelayMin ?? 90;
  const legMin = preview ? Math.max(1, Math.round(preview.timeEstimate / 60)) : 1;

  // Which step is live, when tracking. -1 = just a preview.
  const order = mode === "ghost" ? ["deposit", "leg1", "hold", "leg2", "arrive"] : ["deposit", "swap", "arrive"];
  const at = props.liveStep ?? -1;
  const st = (key: string): StepState => {
    if (at < 0) return "todo";
    const i = order.indexOf(key);
    return i < at ? "done" : i === at ? "now" : "todo";
  };

  const totalSteps = order.length;
  const completedSteps = at < 0 ? 0 : Math.min(totalSteps, at);

  return (
    <section className="passage-panel" aria-label="Transaction steps">
      <header className="passage-panel__head">
        <div className="passage-panel__title-bar">
          <h2>{liveTitle(props.liveStep, mode, statusHint)}</h2>
          <span className={`passage-panel__step-pill ${at >= 0 ? "is-live" : ""}`}>
            {at < 0 ? `${totalSteps} steps` : at >= totalSteps ? `${totalSteps}/${totalSteps} complete` : `Step ${Math.min(totalSteps, at + 1)} of ${totalSteps}`}
          </span>
        </div>
        <p>{mode === "ghost" ? "Routed through shielded ZEC, so no one can link the two sides." : "Filled by NEAR Intents solvers at the best price they offer."}</p>
        {at >= 0 && (
          <div className="pstep-progress" role="progressbar" aria-valuemin={0} aria-valuemax={totalSteps} aria-valuenow={completedSteps}>
            <div className="pstep-progress__fill" style={{ width: `${Math.max(12, Math.round((Math.min(totalSteps, at === totalSteps ? totalSteps : at + 0.5) / totalSteps) * 100))}%` }} />
          </div>
        )}
      </header>
      <ol className="psteps">
        <Step
          stepNum={1}
          state={st("deposit")}
          icon={<TokenIcon symbol={from.symbol} chain={from.blockchain} size={34} />}
          title={`You send ${Number(rawIn) > 0 ? fmtAmount(rawIn) : ""} ${from.symbol}`.trim()}
          detail={
            st("deposit") === "now"
              ? paidTx
                ? `Deposit broadcast on ${chainName(from.blockchain)} — waiting for confirmation…`
                : statusHint ?? `Waiting for deposit on ${chainName(from.blockchain)}…`
              : st("deposit") === "done"
                ? `Confirmed on ${chainName(from.blockchain)}`
                : `on ${chainName(from.blockchain)}`
          }
          aside={inUsd > 0 ? fmtUsd(inUsd) : chainName(from.blockchain)}
        />
        {mode === "ghost" ? (
          <>
            <Step
              stepNum={2}
              state={st("leg1")}
              icon={<TokenIcon symbol={zec.symbol} chain={zec.chain} size={34} />}
              title="Leg one: into ZEC"
              detail={
                st("leg1") === "now"
                  ? "NEAR Intents solvers are converting your deposit into ZEC and shielding into Orchard…"
                  : st("leg1") === "done"
                    ? "Converted into ZEC and shielded into Orchard pool."
                    : "Solvers on NEAR Intents compete to fill it."
              }
              aside={`~${legMin} min`}
            />
            <Step
              stepNum={3}
              state={st("hold")}
              shielded
              icon={<ShieldGlyph />}
              title="Held in the shielded pool"
              detail={
                st("hold") === "now"
                  ? props.holdMinutesLeft
                    ? `Shielded in Zcash Orchard pool — Leg two leaves in ~${props.holdMinutesLeft} min.`
                    : "Shielded in Zcash Orchard pool — breaking timing & amount correlation…"
                  : st("hold") === "done"
                    ? "Shielded hold complete — on-chain link broken."
                    : `A random ${minHold}–${maxHold} min wait breaks the timing link. Amount and owner are hidden here.`
              }
            />
            <Step
              stepNum={4}
              state={st("leg2")}
              icon={<TokenIcon symbol={zec.symbol} chain={zec.chain} size={34} />}
              title={`Leg two: out to ${to.symbol}`}
              detail={
                st("leg2") === "now"
                  ? `Leaving from a fresh shielded note out to ${to.symbol} on ${chainName(to.blockchain)}…`
                  : st("leg2") === "done"
                    ? `Dispatched from fresh address to ${chainName(to.blockchain)}.`
                    : "Leaves from a fresh address with no trail back to leg one."
              }
              aside={`~${legMin} min`}
            />
          </>
        ) : (
          <Step
            stepNum={2}
            state={st("swap")}
            icon={<ShieldGlyph />}
            title="Cross-chain solver fill"
            detail={
              st("swap") === "now"
                ? `Solvers on NEAR Intents are filling your ${from.symbol} → ${to.symbol} route…`
                : st("swap") === "done"
                  ? "Solver fill confirmed."
                  : "Solvers on NEAR Intents compete to fill it."
            }
            aside={`~${legMin} min`}
          />
        )}
        <Step
          stepNum={mode === "ghost" ? 5 : 3}
          state={st("arrive")}
          icon={<TokenIcon symbol={to.symbol} chain={to.blockchain} size={34} />}
          title={`${mode === "ghost" ? "They get" : "You get"} ${Number(estOutAmt) > 0 ? fmtAmount(estOutAmt) : ""} ${to.symbol}`.trim()}
          detail={
            st("arrive") === "done"
              ? `Delivered on ${chainName(to.blockchain)}`
              : `on ${chainName(to.blockchain)}`
          }
          aside={estOutUsd > 0 ? fmtUsd(estOutUsd) : chainName(to.blockchain)}
        />
      </ol>

      <dl className="costs">
        <div>
          <dt>Leeway fee{config ? ` (${(config.appFeeBps / 100).toFixed(2)}%)` : ""}</dt>
          <dd>{fmtUsd(feeUsd)}</dd>
        </div>
        <div>
          <dt>Route and network costs</dt>
          <dd>{fmtUsd(routeUsd)}</dd>
        </div>
        <div className="costs__back">
          <dt>Back to you in shielded ZEC</dt>
          <dd>+{fmtUsd(cashbackUsd)}</dd>
        </div>
        <div>
          <dt>Arrives in</dt>
          <dd>{mode === "ghost" ? `${minHold + legMin * 2}–${maxHold + legMin * 2} min` : `~${legMin} min`}</dd>
        </div>
      </dl>
    </section>
  );
}
