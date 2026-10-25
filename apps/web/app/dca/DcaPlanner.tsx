"use client";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, parseUnits, keccak256, toBytes, type Address, type EIP1193Provider } from "viem";
import { base } from "viem/chains";
import { postJson, useTokens } from "@/components/useTokens";

// Kept in sync with @leeway/core/dca.ts (duplicated so the client bundle stays free of server code).
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const INTERVALS = { weekly: 7 * 86_400, biweekly: 14 * 86_400, monthly: 30 * 86_400 } as const;
type Freq = keyof typeof INTERVALS;

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
const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

interface Plan {
  planId: number;
  zecAddress: string;
  amountPerPeriod: string;
  intervalSec: number;
  periodsTotal: number;
  active: boolean;
}

const isShielded = (a: string) => /^(u1[02-9ac-hj-np-z]{100,}|zs1[02-9ac-hj-np-z]{75})$/.test(a.trim());
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);
const freqLabel = (sec: number) => (sec === 7 * 86_400 ? "every week" : sec === 14 * 86_400 ? "every two weeks" : sec === 30 * 86_400 ? "every month" : `every ${Math.round(sec / 86_400)} days`);

function ethereum(): EIP1193Provider | undefined {
  return (globalThis as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

export function DcaPlanner() {
  const { config } = useTokens();
  const [account, setAccount] = useState<Address | null>(null);
  const [amount, setAmount] = useState("25");
  const [freq, setFreq] = useState<Freq>("weekly");
  const [periods, setPeriods] = useState("12");
  const [zec, setZec] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  const contract = config?.dcaContract as Address | null | undefined;

  const loadPlans = useCallback(async (owner: Address) => {
    const r = await fetch(`/api/dca?owner=${owner}`);
    if (r.ok) setPlans(await r.json());
  }, []);
  useEffect(() => {
    if (account) void loadPlans(account);
  }, [account, loadPlans]);

  async function connect() {
    setError(null);
    const eth = ethereum();
    if (!eth) return setError("No browser wallet found. Open this page in a wallet browser, or install one that supports Base.");
    const wallet = createWalletClient({ chain: base, transport: custom(eth) });
    const [addr] = await wallet.requestAddresses();
    try {
      await wallet.switchChain({ id: base.id });
    } catch {
      await wallet.addChain({ chain: base });
    }
    setAccount(addr);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const eth = ethereum();
    if (!eth || !account || !contract) return;
    if (!isShielded(zec)) return setError("Use a shielded Zcash address: it starts with u1 or zs1.");
    const per = Number(amount);
    if (!(per >= 5)) return setError("The smallest buy is 5 USDC, so network fees don't eat it.");
    const total = Number(periods);
    if (!Number.isInteger(total) || total < 0) return setError("Number of buys must be a whole number. Use 0 to keep going until you stop it.");

    const wallet = createWalletClient({ chain: base, transport: custom(eth), account });
    const pub = createPublicClient({ chain: base, transport: http() });
    const perUnits = parseUnits(amount, 6);
    try {
      // Approve exactly what the plan can spend (or a year of buys for an open-ended plan).
      const budget = perUnits * BigInt(total > 0 ? total : Math.ceil((365 * 86_400) / INTERVALS[freq]));
      const allowance = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [account, contract] });
      if (allowance < budget) {
        setBusy("Approve USDC in your wallet…");
        const h = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [contract, budget] });
        await pub.waitForTransactionReceipt({ hash: h });
      }
      setBusy("Confirm the plan in your wallet…");
      const hash = await wallet.writeContract({
        address: contract,
        abi: dcaAbi,
        functionName: "createPlan",
        args: [USDC, perUnits, INTERVALS[freq], total, keccak256(toBytes(zec.trim()))],
      });
      setBusy("Waiting for Base to confirm…");
      await pub.waitForTransactionReceipt({ hash });
      const r = await postJson<{ planId: number }>("/api/dca", { txHash: hash, zecAddress: zec.trim() });
      setDone(`Plan ${r.planId} is live. The first buy goes out within a few minutes.`);
      await loadPlans(account);
    } catch (err) {
      setError((err as Error).message.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  }

  async function cancel(planId: number) {
    const eth = ethereum();
    if (!eth || !account || !contract) return;
    setError(null);
    try {
      setBusy(`Stopping plan ${planId}…`);
      const wallet = createWalletClient({ chain: base, transport: custom(eth), account });
      const pub = createPublicClient({ chain: base, transport: http() });
      const hash = await wallet.writeContract({ address: contract, abi: dcaAbi, functionName: "cancelPlan", args: [BigInt(planId)] });
      await pub.waitForTransactionReceipt({ hash });
      setPlans((p) => p.map((x) => (x.planId === planId ? { ...x, active: false } : x)));
    } catch (err) {
      setError((err as Error).message.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  }

  if (config && !contract) {
    return <p className="notice">Shielded DCA opens once the Leeway contract is live on Base. Ghost Send and Swap work now.</p>;
  }

  const cashbackPct = config ? (config.cashbackBps / 100).toFixed(2) : "0.20";

  return (
    <>
      {!account ? (
        <button className="btn btn--primary btn--block" onClick={connect}>
          Connect a Base wallet
        </button>
      ) : (
        <form className="card" style={{ display: "grid", gap: 16 }} onSubmit={create}>
          <div className="field">
            <label className="field__label" htmlFor="dca-amount">
              USDC per buy
            </label>
            <input id="dca-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="dca-freq">
              How often
            </label>
            <select id="dca-freq" className="select" value={freq} onChange={(e) => setFreq(e.target.value as Freq)}>
              <option value="weekly">Every week</option>
              <option value="biweekly">Every two weeks</option>
              <option value="monthly">Every month</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="dca-periods">
              Number of buys
            </label>
            <input id="dca-periods" className="input" inputMode="numeric" value={periods} onChange={(e) => setPeriods(e.target.value.replace(/\D/g, ""))} />
            <span className="field__hint">0 keeps it running until you stop it.</span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="dca-zec">
              Your shielded Zcash address
            </label>
            <input id="dca-zec" className="input input--mono" placeholder="u1…" spellCheck={false} autoComplete="off" value={zec} onChange={(e) => setZec(e.target.value)} />
            <span className="field__hint">Each buy, and {cashbackPct}% cashback each month, arrives here. Only a hash of it goes on-chain.</span>
          </div>
          {error && (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          )}
          {done && <p className="notice" role="status">{done}</p>}
          <button className="btn btn--primary btn--block" type="submit" disabled={Boolean(busy)}>
            {busy ?? "Start DCA"}
          </button>
          <span className="field__hint" style={{ textAlign: "center" }}>
            Connected as <code style={{ fontFamily: "var(--font-mono)" }}>{short(account)}</code>
          </span>
        </form>
      )}

      {!account && error && (
        <p className="notice notice--error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}

      {plans.length > 0 && (
        <>
          <h2 style={{ margin: "48px 0 0", font: "400 32px/1.1 var(--font-display)" }}>Your plans</h2>
          <ul className="plans">
            {plans.map((p) => (
              <li key={p.planId}>
                <div>
                  <div>
                    {(Number(p.amountPerPeriod) / 1e6).toLocaleString()} USDC {freqLabel(p.intervalSec)}
                    {p.periodsTotal > 0 ? `, ${p.periodsTotal} buys` : ""}
                  </div>
                  <div className="mono">to {short(p.zecAddress)}</div>
                </div>
                {p.active ? (
                  <button className="btn btn--secondary" onClick={() => cancel(p.planId)} disabled={Boolean(busy)}>
                    Stop
                  </button>
                ) : (
                  <span className="pill">Stopped</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
