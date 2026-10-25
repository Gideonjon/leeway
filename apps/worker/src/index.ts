import { loadConfig } from "@leeway/core";
import { makeContext, type WorkerContext } from "./context.js";
import { tickDca } from "./dca.js";
import { tickGhostLeg2, tickGhosts } from "./ghost.js";
import { tickPayouts } from "./payouts.js";
import { tickCashbackAccrual, tickSwaps } from "./swaps.js";

interface Job {
  name: string;
  everyMs: number;
  run: (ctx: WorkerContext) => Promise<void>;
}

const JOBS: Job[] = [
  { name: "swaps", everyMs: 15_000, run: tickSwaps },
  { name: "ghost", everyMs: 20_000, run: tickGhosts },
  { name: "ghost-leg2", everyMs: 20_000, run: tickGhostLeg2 },
  { name: "cashback", everyMs: 60_000, run: tickCashbackAccrual },
  { name: "dca", everyMs: 5 * 60_000, run: tickDca },
  { name: "payouts", everyMs: 15 * 60_000, run: tickPayouts },
];

async function runJob(ctx: WorkerContext, job: Job) {
  try {
    await job.run(ctx);
  } catch (e) {
    ctx.log(job.name, "tick failed", { error: String(e) });
  }
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.databaseUrl) throw new Error("DATABASE_URL is required");
  const ctx = makeContext(cfg);
  ctx.log("worker", "starting", { jobs: JOBS.map((j) => j.name), dca: Boolean(cfg.dcaContract) });

  if (process.argv.includes("--once")) {
    for (const job of JOBS) await runJob(ctx, job);
    await ctx.db.close();
    return;
  }

  // Each job runs on its own cadence and never overlaps itself.
  for (const job of JOBS) {
    let running = false;
    const fire = async () => {
      if (running) return;
      running = true;
      await runJob(ctx, job);
      running = false;
    };
    void fire();
    setInterval(fire, job.everyMs);
  }

  const shutdown = async () => {
    ctx.log("worker", "stopping");
    await ctx.db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
