import { services, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Public settings the UI shows. Nothing secret. */
export async function GET() {
  const { cfg } = services();
  return json({
    appFeeBps: cfg.appFeeBps,
    cashbackBps: cfg.cashbackBps,
    ghostMaxUsd: cfg.ghostMaxUsd,
    ghostMinDelayMin: Math.round(cfg.ghostMinDelaySec / 60),
    ghostMaxDelayMin: Math.round(cfg.ghostMaxDelaySec / 60),
    ghostPurgeHours: Math.round(cfg.ghostPurgeAfterSec / 3600),
    dcaContract: cfg.dcaContract || null,
  });
}
