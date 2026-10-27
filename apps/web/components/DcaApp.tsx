"use client";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, erc20Abi, keccak256, parseUnits, toBytes, type Address } from "viem";
import { base } from "viem/chains";
import { shortAddr } from "@/lib/chains";
import { SAMPLE_SHIELDED_ZEC, useNetwork } from "./network";
import { NetworkSwitch } from "./Shell";
import { TokenIcon } from "./TokenIcon";
import { fmtBalance, useBalances } from "./useBalances";
import { fmtUsd, postJson, useTokens } from "./useTokens";
import { useWallet } from "./Wallet";
import { WalletModal } from "./WalletModal";

const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FREQS = [
  { key: "weekly", label: "Weekly", sec: 7 * 86_400, perYear: 52 },
  { key: "biweekly", label: "Every 2 weeks", sec: 14 * 86_400, perYear: 26 },
  { key: "monthly", label: "Monthly", sec: 30 * 86_400, perYear: 12 },
] as const;

const dcaAbi = [
  {
    type: "function",
    name: "createPlan",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountPerPeriod", type: "uint128" },
      { name: "interval", type: "uint32" },
      { name: "periodsTotal", type: "uint32" },
      { name: "zecRecipientHash", type: "bytes32" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "cancelPlan", stateMutability: "nonpayable", inputs: [{ name: "planId", type: "uint256" }], outputs: [] },
] as const;

interface Plan {
  planId: number;
  amountPerPeriod: string;
  intervalSec: number;
  periodsTotal: number;
  active: boolean;
}

const isShielded = (a: string) => /^(u1[02-9ac-hj-np-z]{100,}|zs1[02-9ac-hj-np-z]{75})$/.test(a.trim());

export function DcaApp() {
  const { tokens, config } = useTokens();
  const wallet = useWallet();
  const { balanceOf, isChainConnected } = useBalances(tokens);
  const [net] = useNetwork();
  const isTestnet = net === "testnet";
  const [amount, setAmount] = useState("25");
  const [freq, setFreq] = useState<(typeof FREQS)[number]>(FREQS[0]);
  const [buys, setBuys] = useState("12");
  const [zec, setZec] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dcaStep, setDcaStep] = useState<number>(-1);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [walletOpen, setWalletOpen] = useState(false);
  const contract = config?.dcaContract as Address | null | undefined;
  const zecPrice = tokens.find((t) => t.assetId === "nep141:zec.omft.near")?.price ?? 0;
  const baseUsdc = tokens.find((t) => t.symbol === "USDC" && t.blockchain === "base");
  const usdcBal = balanceOf(baseUsdc);
  const baseConnected = isChainConnected(baseUsdc);

  useEffect(() => {
    try {
      setZec(localStorage.getItem("leeway.cashback") ?? "");
    } catch {}
  }, []);

  const load = useCallback(async (owner: string) => {
    const r = await fetch(`/api/dca?owner=${owner}`);
    if (r.ok) setPlans(await r.json());
  }, []);
  const activeOwner = wallet.address ?? (isTestnet ? "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" : null);

  useEffect(() => {
    if (activeOwner) void load(activeOwner);
  }, [activeOwner, load]);

  const per = Number(amount) || 0;
  const n = Number(buys) || 0;
  const total = per * (n || freq.perYear);
  const zecEach = zecPrice ? per / zecPrice : 0;
  const cashPct = config ? config.cashbackBps / 100 : 0.2;

  async function create() {
    setError(null);
    setDone(null);
    if (!isShielded(zec)) return setError("Use a shielded Zcash address. It starts with u1 or zs1.");
    if (per < 5) return setError("The smallest buy is 5 USDC, so network fees don't eat it.");

    if (isTestnet) {
      const owner = activeOwner!;
      setBusy("Step 1/3: Approving Testnet USDC allowance…");
      setDcaStep(0);
      try {
        await new Promise((r) => setTimeout(r, 700));
        setBusy("Step 2/3: Creating Shielded DCA plan on Base…");
        setDcaStep(1);
        const r = await postJson<{ planId: number }>("/api/testnet", {
          action: "dca-create",
          owner,
          zecAddress: zec.trim(),
          amount: per,
          intervalSec: freq.sec,
          periodsTotal: n,
        });
        await new Promise((r) => setTimeout(r, 700));
        setDcaStep(2);
        try {
          localStorage.setItem("leeway.cashback", zec.trim());
        } catch {}
        setDone(`Testnet Plan #${Math.abs(r.planId)} is live. Click "Simulate Buy" on the right to test a period run.`);
        await load(owner);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
      return;
    }

    if (!contract) return;
    if (!wallet.evm?.provider) {
      setWalletOpen(true);
      return;
    }
    const provider = wallet.evm.provider;
    const account = wallet.evm.address;
    const w = createWalletClient({ chain: base, transport: custom(provider), account });
    const pub = createPublicClient({ chain: base, transport: custom(provider) });
    try {
      setDcaStep(0);
      await w.switchChain({ id: base.id }).catch(() => w.addChain({ chain: base }));
      const perUnits = parseUnits(amount, 6);
      const budget = perUnits * BigInt(n > 0 ? n : freq.perYear);
      const allowance = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [account, contract] });
      if (allowance < budget) {
        setBusy("Step 1/3: Approve USDC in your wallet…");
        const h = await w.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [contract, budget] });
        await pub.waitForTransactionReceipt({ hash: h });
      }
      setDcaStep(1);
      setBusy("Step 2/3: Confirm the DCA plan in your wallet…");
      const hash = await w.writeContract({ address: contract, abi: dcaAbi, functionName: "createPlan", args: [USDC, perUnits, freq.sec, n, keccak256(toBytes(zec.trim()))] });
      setBusy("Step 3/3: Waiting for Base confirmation…");
      await pub.waitForTransactionReceipt({ hash });
      setDcaStep(2);
      const r = await postJson<{ planId: number }>("/api/dca", { txHash: hash, zecAddress: zec.trim() });
      try {
        localStorage.setItem("leeway.cashback", zec.trim());
      } catch {}
      setDone(`Plan ${r.planId} is live. Your first buy goes out within a few minutes.`);
      await load(account);
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  }

  async function stop(id: number) {
    if (id < 0) {
      setError(null);
      setBusy(`Stopping Testnet plan #${Math.abs(id)}…`);
      try {
        await postJson("/api/testnet", { action: "dca-stop", planId: id });
        setPlans((p) => p.map((x) => (x.planId === id ? { ...x, active: false } : x)));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
      return;
    }
    const provider = wallet.evm?.provider;
    if (!provider || !wallet.address || !contract) return;
    setError(null);
    try {
      setBusy(`Stopping plan ${id}…`);
      const w = createWalletClient({ chain: base, transport: custom(provider), account: wallet.address });
      const pub = createPublicClient({ chain: base, transport: custom(provider) });
      const hash = await w.writeContract({ address: contract, abi: dcaAbi, functionName: "cancelPlan", args: [BigInt(id)] });
      await pub.waitForTransactionReceipt({ hash });
      setPlans((p) => p.map((x) => (x.planId === id ? { ...x, active: false } : x)));
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  }

  async function simulateBuy(id: number) {
    if (!activeOwner) return;
    setError(null);
    setDone(null);
    setBusy(`Simulating buy for plan #${Math.abs(id)}…`);
    try {
      await postJson("/api/testnet", { action: "dca-run", planId: id, owner: activeOwner });
      setDone(`Simulated 1 DCA buy for Plan #${Math.abs(id)} — ZEC cashback accrued (check the Cashback tab).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="stage stage--split">
      <section className="widget" aria-label="Shielded DCA">
        <header className="widget__head">
          <div className="widget__head-top">
            <h1>Shielded DCA</h1>
            <div className="widget__head-actions">
              {isTestnet && (
                <button type="button" className="chip-btn chip-btn--sm" onClick={() => setZec(SAMPLE_SHIELDED_ZEC)}>
                  Fill test ZEC address
                </button>
              )}
              <NetworkSwitch compact />
            </div>
          </div>
          <p>Buy ZEC on a schedule. Your USDC stays in your wallet until the day it&apos;s spent.</p>
        </header>
        <form
          className="widget__body"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="tcard">
            <div className="tcard__row">
              <span className="tcard__label">Each buy</span>
              <span className="tcard__meta tcard__meta--bal">
                <span>
                  Balance: <strong>{fmtBalance(usdcBal)}</strong> USDC
                </span>
                {!baseConnected && <span className="bal-tag">Wallet not connected</span>}
              </span>
            </div>
            <div className="tcard__main">
              <span className="tok-btn tok-btn--static">
                <TokenIcon symbol="USDC" chain="base" size={36} />
                <span className="tok-btn__text">
                  <strong>USDC</strong>
                  <span>Base</span>
                </span>
              </span>
              <input className="tcard__amount" inputMode="decimal" aria-label="USDC per buy" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            <div className="tcard__row tcard__row--foot">
              <span>{zecEach ? `≈ ${zecEach.toPrecision(3)} ZEC per buy at today's price` : " "}</span>
            </div>
          </div>

          <div className="seg seg--block" role="radiogroup" aria-label="How often">
            {FREQS.map((f) => (
              <button type="button" key={f.key} role="radio" aria-checked={freq.key === f.key} className="seg__item" aria-current={freq.key === f.key ? "true" : undefined} onClick={() => setFreq(f)}>
                {f.label}
              </button>
            ))}
          </div>

          <div className="opts">
            <label className="opt">
              <span className="opt__label">Number of buys</span>
              <input className="opt__input opt__input--short" inputMode="numeric" value={buys} onChange={(e) => setBuys(e.target.value.replace(/\D/g, ""))} aria-describedby="buys-hint" />
            </label>
            <p className="hint" id="buys-hint">
              0 keeps it running until you stop it.
            </p>
            <label className="opt">
              <span className="opt__label">Deliver to</span>
              <input className="opt__input" placeholder="Your shielded address, u1…" value={zec} onChange={(e) => setZec(e.target.value)} spellCheck={false} autoComplete="off" />
            </label>
            {zec && !isShielded(zec) && <p className="hint hint--error">Use a shielded Zcash address, starting with u1 or zs1.</p>}
          </div>

          <dl className="summary">
            <div>
              <dt>{n > 0 ? "Total over the plan" : "Spend per year"}</dt>
              <dd>{fmtUsd(total)}</dd>
            </div>
            <div>
              <dt>Cashback, monthly</dt>
              <dd className="pos">+{fmtUsd((total * cashPct) / 100)}</dd>
            </div>
          </dl>

          {error && (
            <p className="note note--error" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="note" role="status">
              {done}
            </p>
          )}

          {!contract && !isTestnet ? (
            <p className="note">Shielded DCA switches on once the Leeway contract is live on Base. Ghost Send and Swap work now.</p>
          ) : (
            <button className="cta" type="submit" disabled={Boolean(busy)}>
              {busy ?? (isTestnet ? "Start Testnet DCA" : wallet.address ? "Start DCA" : "Connect wallet to start")}
            </button>
          )}
        </form>
      </section>

      <section className="passage-panel" aria-label="How DCA works">
        <header className="passage-panel__head">
          <h2>{plans.length ? "Your plans" : "How each buy runs"}</h2>
          <p>{plans.length ? "Stop any plan here, or revoke the USDC allowance in your wallet." : "Your USDC never sits with Leeway."}</p>
        </header>
        {plans.length ? (
          <ul className="plan-list">
            {plans.map((p) => (
              <li key={p.planId} className="plan">
                <TokenIcon symbol="ZEC" chain="zec" size={36} />
                <div className="plan__text">
                  <strong>
                    {(Number(p.amountPerPeriod) / 1e6).toLocaleString()} USDC {FREQS.find((f) => f.sec === p.intervalSec)?.label.toLowerCase() ?? `every ${Math.round(p.intervalSec / 86_400)} days`}
                  </strong>
                  <span>
                    {p.periodsTotal ? `${p.periodsTotal} buys, delivered shielded` : "Runs until you stop it"}
                  </span>
                </div>
                {p.active ? (
                  <div className="plan__actions">
                    {p.planId < 0 && (
                      <button className="chip-btn" onClick={() => void simulateBuy(p.planId)} disabled={Boolean(busy)}>
                        Simulate Buy
                      </button>
                    )}
                    <button className="chip-btn" onClick={() => void stop(p.planId)} disabled={Boolean(busy)}>
                      Stop
                    </button>
                  </div>
                ) : (
                  <span className="pill">Stopped</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <ol className="psteps">
            <li className={`pstep pstep--${dcaStep < 0 ? "todo" : dcaStep === 0 ? "now" : "done"}`}>
              <span className="pstep__icon">
                <TokenIcon symbol="USDC" chain="base" size={34} />
              </span>
              <div className="pstep__body">
                <div className="pstep__title">1. Approve & schedule USDC on Base</div>
                <div className="pstep__detail">The contract can only take {per ? fmtUsd(per) : "your amount"} once per period. Nothing else.</div>
              </div>
            </li>
            <li className={`pstep pstep--${dcaStep < 1 ? "todo" : dcaStep === 1 ? "now" : "done"}`}>
              <span className="pstep__icon">
                <TokenIcon symbol="ZEC" chain="zec" size={34} />
              </span>
              <div className="pstep__body">
                <div className="pstep__title">2. NEAR Intents buys ZEC</div>
                <div className="pstep__detail">Solvers compete for the best price on each buy.</div>
              </div>
            </li>
            <li className={`pstep pstep--${dcaStep < 2 ? "todo" : "done"} pstep--shielded`}>
              <span className="pstep__icon">
                <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
                  <path d="M14 54 A40 40 0 0 1 54 14" fill="none" stroke="var(--lee)" strokeWidth="11" strokeLinecap="round" />
                  <circle cx="46" cy="46" r="8" fill="var(--lantern)" />
                </svg>
              </span>
              <div className="pstep__body">
                <div className="pstep__title">3. Lands shielded in your wallet</div>
                <div className="pstep__detail">Only a hash of your Zcash address goes on Base. Stop any time, or revoke the allowance.</div>
              </div>
            </li>
          </ol>
        )}
      </section>
      {walletOpen && <WalletModal onClose={() => setWalletOpen(false)} />}
    </main>
  );
}
