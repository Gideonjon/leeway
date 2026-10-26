import { loadConfig, productionProblems } from "@leeway/core";
import { makeContext, type WorkerContext } from "./context.js";
import { tickDca } from "./dca.js";
import { tickGhostLeg2, tickGhosts } from "./ghost.js";
import { tickPayouts } from "./payouts.js";
import { tickCashbackAccrual, tickSwaps } from "./swaps.js";

interface Job {
  name: string;
  everyMs: number;
  run: (ctx: WorkerContext) => Promise<void>;
  /** Needs the Zcash wallet. */
  wallet?: boolean;
}

const JOBS: Job[] = [
  { name: "swaps", everyMs: 15_000, run: tickSwaps },
  { name: "ghost", everyMs: 20_000, run: tickGhosts, wallet: true },
  { name: "ghost-leg2", everyMs: 20_000, run: tickGhostLeg2 },
  { name: "cashback", everyMs: 60_000, run: tickCashbackAccrual },
  { name: "dca", everyMs: 5 * 60_000, run: tickDca },
  { name: "payouts", everyMs: 15 * 60_000, run: tickPayouts, wallet: true },
];

async function runJob(ctx: WorkerContext, job: Job) {
  try {
    await job.run(ctx);
    await ctx.db.heartbeat(job.name).catch(() => undefined);
  } catch (e) {
    ctx.log(job.name, "tick failed", { error: String(e) });
    await ctx.db.heartbeat(job.name, String(e)).catch(() => undefined);
  }
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.databaseUrl) throw new Error("DATABASE_URL is required");
  if (cfg.production) {
    const problems = productionProblems(cfg, "worker");
    if (problems.length) {
      console.error("Refusing to start in production:\n- " + problems.join("\n- "));
      process.exit(1);
    }
  }
  const ctx = makeContext(cfg);

  // Exactly one worker may move money. A second instance waits instead of double-sending.
  const unlock = await ctx.db.acquireWorkerLock();
  if (!unlock) {
    ctx.log("worker", "another worker holds the lock; exiting");
    await ctx.db.close();
    process.exit(0);
  }

  // Check the wallet speaks every RPC method we rely on before touching funds.
  let walletOk = true;
  try {
    const missing = await ctx.wallet.missingMethods();
    if (missing.length) {
      walletOk = false;
      ctx.log("worker", "WALLET INCOMPATIBLE: Ghost Send and payouts disabled", { missing });
    }
  } catch (e) {
    walletOk = false;
    ctx.log("worker", "WALLET UNREACHABLE: Ghost Send and payouts disabled", { error: String(e) });
  }
  if (!walletOk && cfg.production) {
    console.error("Refusing to start in production without a working Zcash wallet RPC.");
    await unlock();
    process.exit(1);
  }
  const jobs = JOBS.filter((j) => walletOk || !j.wallet);
  ctx.log("worker", "starting", { jobs: jobs.map((j) => j.name), dca: Boolean(cfg.dcaContract), walletOk });

  if (process.argv.includes("--once")) {
    for (const job of jobs) await runJob(ctx, job);
    await unlock();
    await ctx.db.close();
    return;
  }

  const running = new Set<Promise<void>>();
  const timers: NodeJS.Timeout[] = [];
  let stopping = false;
  for (const job of jobs) {
    let busy = false;
    const fire = () => {
      if (busy || stopping) return;
      busy = true;
      const p = runJob(ctx, job).finally(() => {
        busy = false;
        running.delete(p);
      });
      running.add(p);
    };
    fire();
    timers.push(setInterval(fire, job.everyMs));
  }

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    ctx.log("worker", "stopping", { signal, inFlight: running.size });
    timers.forEach(clearInterval);
    // Let in-flight jobs finish so no send is cut off half-recorded.
    await Promise.race([Promise.allSettled([...running]), new Promise((r) => setTimeout(r, 60_000))]);
    await unlock();
    await ctx.db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
