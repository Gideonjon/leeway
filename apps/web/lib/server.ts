import "server-only";
import { LeewayDb, loadConfig, OneClickClient, OneClickError, ZcashRpcWallet, type LeewayConfig, type Token } from "@leeway/core";

interface Services {
  cfg: LeewayConfig;
  db: LeewayDb;
  oneclick: OneClickClient;
  wallet: ZcashRpcWallet;
}

const g = globalThis as unknown as { __leeway?: Services; __leewayTokens?: { at: number; tokens: Token[] } };

/** Process-wide singletons (survive Next dev hot reloads). */
export function services(): Services {
  if (!g.__leeway) {
    const cfg = loadConfig();
    g.__leeway = {
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
