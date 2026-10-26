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

function liveTitle(step: number | undefined, mode: "ghost" | "swap") {
  if (step === undefined) return mode === "ghost" ? "The passage" : "Route";
  const last = mode === "ghost" ? 5 : 3;
  if (step >= last) return "Delivered";
  if (step === 0) return "Waiting for your deposit";
  return "On its way";
}

function Step(props: { state: StepState; shielded?: boolean; title: string; detail: React.ReactNode; aside?: React.ReactNode; icon: React.ReactNode }) {
  return (
    <li className={`pstep pstep--${props.state} ${props.shielded ? "pstep--shielded" : ""}`}>
      <span className="pstep__icon">{props.icon}</span>
      <div className="pstep__body">
        <div className="pstep__title">{props.title}</div>
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
 * The route, drawn as the passage it is. With `phase`, it doubles as the live tracker.
 */
export function PassagePanel(props: {
  mode: "ghost" | "swap";
  from: TokenOption;
  to: TokenOption;
  preview: Preview;
  config: PublicConfig | null;
  phase?: Phase;
  /** Index of the live step while tracking; order.length when delivered. */
  liveStep?: number;
  holdMinutesLeft?: number | null;
}) {
  const { from, to, preview, config, mode, phase } = props;
  const zec = { symbol: "ZEC", chain: "zec" };
  const inUsd = Number(preview.amountInUsd);
  const outUsd = Number(preview.amountOutUsd);
  const feeUsd = config ? (inUsd * config.appFeeBps) / 10_000 : 0;
  const routeUsd = Math.max(0, inUsd - outUsd - feeUsd);
  const minHold = config?.ghostMinDelayMin ?? 10;
  const maxHold = config?.ghostMaxDelayMin ?? 90;
  const legMin = Math.max(1, Math.round(preview.timeEstimate / 60));

  // Which step is live, when tracking. -1 = just a preview.
  const order = mode === "ghost" ? ["deposit", "leg1", "hold", "leg2", "arrive"] : ["deposit", "swap", "arrive"];
  const at = props.liveStep ?? -1;
  const st = (key: string): StepState => {
    if (at < 0) return "todo";
    const i = order.indexOf(key);
    return i < at ? "done" : i === at ? "now" : "todo";
  };

  return (
    <section className="passage-panel" aria-label="Route">
      <header className="passage-panel__head">
        <h2>{liveTitle(props.liveStep, mode)}</h2>
        <p>{mode === "ghost" ? "Routed through shielded ZEC, so no one can link the two sides." : "Filled by NEAR Intents solvers at the best price they offer."}</p>
      </header>
      <ol className="psteps">
        <Step
          state={st("deposit")}
          icon={<TokenIcon symbol={from.symbol} chain={from.blockchain} size={34} />}
          title={`You send ${fmtAmount(preview.amountIn)} ${from.symbol}`}
          detail={`on ${chainName(from.blockchain)}`}
          aside={fmtUsd(inUsd)}
        />
        {mode === "ghost" ? (
          <>
            <Step
              state={st("leg1")}
              icon={<TokenIcon symbol={zec.symbol} chain={zec.chain} size={34} />}
              title="Leg one: into ZEC"
              detail="Solvers on NEAR Intents compete to fill it."
              aside={`~${legMin} min`}
            />
            <Step
              state={st("hold")}
              shielded
              icon={<ShieldGlyph />}
              title="Held in the shielded pool"
              detail={
                st("hold") === "now" && props.holdMinutesLeft
                  ? `Leg two leaves in about ${props.holdMinutesLeft} min`
                  : `A random ${minHold}–${maxHold} min wait breaks the timing link. Amount and owner are hidden here.`
              }
            />
            <Step
              state={st("leg2")}
              icon={<TokenIcon symbol={zec.symbol} chain={zec.chain} size={34} />}
              title={`Leg two: out to ${to.symbol}`}
              detail="Leaves from a fresh address with no trail back to leg one."
              aside={`~${legMin} min`}
            />
          </>
        ) : (
          <Step state={st("swap")} icon={<ShieldGlyph />} title="Swap" detail="Solvers on NEAR Intents compete to fill it." aside={`~${legMin} min`} />
        )}
        <Step
          state={st("arrive")}
          icon={<TokenIcon symbol={to.symbol} chain={to.blockchain} size={34} />}
          title={`${mode === "ghost" ? "They get" : "You get"} ${fmtAmount(preview.amountOut)} ${to.symbol}`}
          detail={`on ${chainName(to.blockchain)}`}
          aside={fmtUsd(outUsd)}
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
          <dd>+{fmtUsd(preview.cashbackUsd)}</dd>
        </div>
        <div>
          <dt>Arrives in</dt>
          <dd>{mode === "ghost" ? `${minHold + legMin * 2}–${maxHold + legMin * 2} min` : `~${legMin} min`}</dd>
        </div>
      </dl>
    </section>
  );
}
