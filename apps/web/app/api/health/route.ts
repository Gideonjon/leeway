import { json, services } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Liveness and readiness for load balancers and alerting. Reports the database, the route
 * provider, each worker job's last success, and anything waiting for a human.
 * Returns 503 when something needs attention, so an uptime monitor can page you.
 */
export async function GET() {
  const { db, oneclick } = services();
  const out: Record<string, unknown> = { ok: true, at: new Date().toISOString() };
  const problems: string[] = [];
  try {
    await db.ping();
    out.db = "ok";
  } catch {
    out.db = "down";
    problems.push("database");
  }
  try {
    await oneclick.tokens();
    out.routes = "ok";
  } catch {
    out.routes = "down";
    problems.push("1click");
  }
  if (out.db === "ok") {
    const beats = await db.heartbeats().catch(() => []);
    const stale = beats.filter((b) => !b.okAt || Date.now() - new Date(b.okAt).getTime() > 20 * 60_000).map((b) => b.job);
    out.worker = beats.length === 0 ? "never seen" : stale.length ? { stale } : "ok";
    if (beats.length === 0 || stale.length) problems.push("worker");
    const review = await db.reviewQueue().catch(() => ({ ghosts: -1, payouts: -1 }));
    out.needsReview = review;
    if (review.ghosts || review.payouts) problems.push("review-queue");
  }
  out.ok = problems.length === 0;
  out.problems = problems;
  return json(out, problems.length ? 503 : 200);
}
