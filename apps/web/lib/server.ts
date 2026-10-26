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
  type Token,
} from "@leeway/core";

interface Services {
  cfg: LeewayConfig;
  db: LeewayDb;
  oneclick: OneClickClient;
  wallet: ZcashRpcWallet;
  screener: Screener;
}

const g = globalThis as unknown as { __leeway?: Services; __leewayTokens?: { at: number; tokens: Token[] } };

/** Process-wide singletons (survive Next dev hot reloads). */
export function services(): Services {
  if (!g.__leeway) {
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

/** The 1Click token list, cached for a minute. */
export async function tokens(): Promise<Token[]> {
  const c = g.__leewayTokens;
  if (c && Date.now() - c.at < 60_000) return c.tokens;
  const list = await services().oneclick.tokens();
  g.__leewayTokens = { at: Date.now(), tokens: list };
  return list;
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
  try {
    const ok = await db.rateLimit(`${route}:${clientKey(req)}`, opts.perMin ?? cfg.rateLimitPerMin);
    if (!ok) return new Response(JSON.stringify({ error: "Too many requests. Wait a minute and try again." }), { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } });
  } catch (e) {
    console.error("[leeway] rate limiter unavailable", e);
    return fail("Leeway is busy. Try again in a moment.", 503);
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
