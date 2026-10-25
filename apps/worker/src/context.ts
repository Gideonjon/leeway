import { LeewayDb, OneClickClient, ZcashRpcWallet, zecPrice, type LeewayConfig, type ShieldedWallet, type Token } from "@leeway/core";

export interface WorkerContext {
  cfg: LeewayConfig;
  db: LeewayDb;
  oneclick: OneClickClient;
  wallet: ShieldedWallet;
  log: (scope: string, msg: string, extra?: Record<string, unknown>) => void;
  /** ZEC price in USD, cached for a minute. */
  zecUsd: () => Promise<number>;
  tokens: () => Promise<Token[]>;
}

export function makeContext(cfg: LeewayConfig): WorkerContext {
  const oneclick = new OneClickClient(cfg.oneClickBaseUrl, cfg.oneClickApiKey);
  let cache: { at: number; tokens: Token[] } | null = null;
  const tokens = async () => {
    if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), tokens: await oneclick.tokens() };
    return cache.tokens;
  };
  return {
    cfg,
    db: new LeewayDb(cfg.databaseUrl),
    oneclick,
    wallet: new ZcashRpcWallet(cfg.zcashRpcUrl, cfg.zcashRpcUser, cfg.zcashRpcPassword, cfg.zcashAccount),
    log: (scope, msg, extra) =>
      console.log(JSON.stringify({ t: new Date().toISOString(), scope, msg, ...(extra ?? {}) })),
    tokens,
    zecUsd: async () => zecPrice(await tokens()),
  };
}
