import "server-only";
import {
  LeewayDb,
  loadConfig,
  makeScreener,
  OneClickClient,
  OneClickError,
  productionProblems,
  ScreeningUnavailable,
  ZcashRpcWallet,
  type LeewayConfig,
  type Screener,
  type Stats,
  type Token,
} from "@leeway/core";

interface Services {
  cfg: LeewayConfig;
  db: LeewayDb;
  oneclick: OneClickClient;
  wallet: ZcashRpcWallet;
  screener: Screener;
}

const g = globalThis as unknown as {
  __leeway?: Services;
  __leewayTokens?: { at: number; tokens: Token[]; inflight?: Promise<Token[]> };
  __leewayStats?: { at: number; stats: Stats; inflight?: Promise<Stats> };
  __leewayMemRate?: Map<string, { window: number; count: number }>;
};

/** Process-wide singletons (survive Next dev hot reloads). */
export function services(): Services {
  const currentDca = process.env.LEEWAY_DCA_CONTRACT ?? "";
  const currentFee = process.env.LEEWAY_FEE_RECIPIENT ?? "";
  if (!g.__leeway || g.__leeway.cfg.dcaContract !== currentDca || g.__leeway.cfg.feeRecipient !== currentFee) {
    const cfg = loadConfig();
    if (cfg.production) {
      const problems = productionProblems(cfg, "web");
      if (problems.length) throw new Error("Leeway is misconfigured for production:\n- " + problems.join("\n- "));
    }
    g.__leeway = {
      screener: makeScreener({ apiKey: cfg.screeningApiKey, failOpen: cfg.screeningFailOpen }),
      cfg,
      db: new LeewayDb(cfg.databaseUrl),
      oneclick: new OneClickClient(cfg.oneClickBaseUrl, cfg.oneClickApiKey),
      wallet: new ZcashRpcWallet(cfg.zcashRpcUrl, cfg.zcashRpcUser, cfg.zcashRpcPassword, cfg.zcashAccount),
    };
  }
  return g.__leeway;
}

/** The 1Click token list, cached for 5 minutes with stale-while-revalidate. */
export async function tokens(): Promise<Token[]> {
  const c = g.__leewayTokens;
  const now = Date.now();
  if (c && now - c.at < 300_000) return c.tokens;
  if (c) {
    c.inflight ??= services()
      .oneclick.tokens()
      .then((list) => {
        g.__leewayTokens = { at: Date.now(), tokens: list };
        return list;
      })
      .catch(() => c.tokens);
    return c.tokens;
  }
  const list = await services().oneclick.tokens();
  g.__leewayTokens = { at: Date.now(), tokens: list };
  return list;
}

/** Aggregate protocol stats, cached for 30s with stale-while-revalidate. */
export async function cachedStats(): Promise<Stats> {
  const c = g.__leewayStats;
  const now = Date.now();
  if (c && now - c.at < 30_000) return c.stats;
  if (c) {
    c.inflight ??= services()
      .db.stats()
      .then((s) => {
        g.__leewayStats = { at: Date.now(), stats: s };
        return s;
      })
      .catch(() => c.stats);
    return c.stats;
  }
  const s = await services().db.stats();
  g.__leewayStats = { at: Date.now(), stats: s };
  return s;
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

/**
 * Turns thrown errors into a short message a person can act on.
 * Only 1Click's own messages (bad amount, unsupported route…) reach the user; anything
 * internal (database, wallet, network) is logged and replaced with a plain retry message.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof OneClickError) {
    if (e.status >= 500) return "The route provider is busy. Try again in a moment.";
    return e.message.replace(/^1Click (GET|POST) \S+ failed: /, "");
  }
  console.error("[leeway]", e);
  return "Leeway couldn't do that just now. Nothing was sent. Try again in a moment.";
}

/** Best-effort client IP behind a proxy (first X-Forwarded-For hop), for rate limiting only. Never stored as-is. */
function clientKey(req: Request) {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || req.headers.get("x-real-ip") || "unknown";
  // Hash so raw IPs never land in the database.
  let h = 2166136261;
  for (const c of ip) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * Shared guard for API routes: per-IP rate limit (across instances, via Postgres) and a
 * small request-body cap. Returns a Response to send back, or null to continue.
 */
export async function guard(req: Request, route: string, opts: { perMin?: number; maxBytes?: number } = {}): Promise<Response | null> {
  const { cfg, db } = services();
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > (opts.maxBytes ?? 8_192)) return fail("Request too large.", 413);
  const key = `${route}:${clientKey(req)}`;
  const limit = opts.perMin ?? cfg.rateLimitPerMin;
  const win = Math.floor(Date.now() / 60_000);
  const map = (g.__leewayMemRate ??= new Map());
  const cur = map.get(key);
  const count = cur && cur.window === win ? cur.count + 1 : 1;
  map.set(key, { window: win, count });
  if (map.size > 5_000) {
    for (const [k, v] of map.entries()) if (v.window < win) map.delete(k);
  }
  void db.rateLimit(key, limit).catch(() => undefined);
  if (count > limit) {
    return new Response(JSON.stringify({ error: "Too many requests. Wait a minute and try again." }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60" },
    });
  }
  return null;
}

/** Screens addresses when screening is configured. Returns an error Response, or null when clear. */
export async function screen(addresses: string[]): Promise<Response | null> {
  const { screener } = services();
  if (!screener.enabled) return null;
  try {
    const hits = await screener.check(addresses);
    if (hits.length) return fail("Leeway can't process transfers involving this address.", 403);
  } catch (e) {
    if (e instanceof ScreeningUnavailable) return fail("Address checks are unavailable right now, so Leeway can't accept new transfers. Try again shortly.", 503);
    throw e;
  }
  return null;
}
