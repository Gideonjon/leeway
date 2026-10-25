/** Runtime configuration, read once from the environment. */
export interface LeewayConfig {
  /** 1Click partner API key (Partner Dashboard). */
  oneClickApiKey: string;
  oneClickBaseUrl: string;
  /** NEAR Intents account that receives the app fee (an ANY_INPUT deposit address or a .near account). */
  feeRecipient: string;
  /** App fee charged on every swap, in basis points. */
  appFeeBps: number;
  /** Share returned to the user as cashback, in basis points of the swap's USD value. */
  cashbackBps: number;
  /** Smallest cashback payout, in zatoshis (1 ZEC = 1e8 zat). */
  cashbackMinZat: bigint;
  /** Max cashback paid in any rolling 24h window, in zatoshis. */
  cashbackDailyCapZat: bigint;
  /** Ghost Send hold window, in seconds. A random delay inside it is drawn per transfer. */
  ghostMinDelaySec: number;
  ghostMaxDelaySec: number;
  /** Ghost Send cap per transfer, in USD. */
  ghostMaxUsd: number;
  /** Purge linking data this many seconds after a Ghost Send completes. */
  ghostPurgeAfterSec: number;
  /** Reserve left for Zcash network fees on each wallet-sent leg, in zatoshis. */
  zecFeeReserveZat: bigint;
  slippageBps: number;
  databaseUrl: string;
  zcashRpcUrl: string;
  zcashRpcUser: string;
  zcashRpcPassword: string;
  /** Account index in the backend wallet used as the Leeway hop/cashback account. */
  zcashAccount: number;
  baseRpcUrl: string;
  dcaContract: `0x${string}` | "";
  keeperPrivateKey: `0x${string}` | "";
}

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));
const big = (v: string | undefined, d: bigint) => (v === undefined || v === "" ? d : BigInt(v));

export function loadConfig(env: Record<string, string | undefined> = process.env): LeewayConfig {
  const cfg: LeewayConfig = {
    oneClickApiKey: env.ONECLICK_API_KEY ?? "",
    oneClickBaseUrl: env.ONECLICK_BASE_URL ?? "https://1click.chaindefuser.com",
    feeRecipient: env.LEEWAY_FEE_RECIPIENT ?? "",
    appFeeBps: num(env.LEEWAY_APP_FEE_BPS, 50),
    cashbackBps: num(env.LEEWAY_CASHBACK_BPS, 20),
    cashbackMinZat: big(env.LEEWAY_CASHBACK_MIN_ZAT, 100_000n), // 0.001 ZEC
    cashbackDailyCapZat: big(env.LEEWAY_CASHBACK_DAILY_CAP_ZAT, 1_000_000_000n), // 10 ZEC
    ghostMinDelaySec: num(env.LEEWAY_GHOST_MIN_DELAY_SEC, 10 * 60),
    ghostMaxDelaySec: num(env.LEEWAY_GHOST_MAX_DELAY_SEC, 90 * 60),
    ghostMaxUsd: num(env.LEEWAY_GHOST_MAX_USD, 2_000),
    ghostPurgeAfterSec: num(env.LEEWAY_GHOST_PURGE_AFTER_SEC, 24 * 3600),
    zecFeeReserveZat: big(env.LEEWAY_ZEC_FEE_RESERVE_ZAT, 30_000n),
    slippageBps: num(env.LEEWAY_SLIPPAGE_BPS, 100),
    databaseUrl: env.DATABASE_URL ?? "",
    zcashRpcUrl: env.ZCASH_RPC_URL ?? "http://127.0.0.1:8232",
    zcashRpcUser: env.ZCASH_RPC_USER ?? "",
    zcashRpcPassword: env.ZCASH_RPC_PASSWORD ?? "",
    zcashAccount: num(env.ZCASH_ACCOUNT, 0),
    baseRpcUrl: env.BASE_RPC_URL ?? "https://mainnet.base.org",
    dcaContract: (env.LEEWAY_DCA_CONTRACT ?? "") as LeewayConfig["dcaContract"],
    keeperPrivateKey: (env.KEEPER_PRIVATE_KEY ?? "") as LeewayConfig["keeperPrivateKey"],
  };
  if (cfg.cashbackBps > cfg.appFeeBps) {
    throw new Error("LEEWAY_CASHBACK_BPS cannot exceed LEEWAY_APP_FEE_BPS: cashback is paid out of the fee.");
  }
  if (cfg.ghostMinDelaySec > cfg.ghostMaxDelaySec) {
    throw new Error("LEEWAY_GHOST_MIN_DELAY_SEC must be <= LEEWAY_GHOST_MAX_DELAY_SEC.");
  }
  return cfg;
}
