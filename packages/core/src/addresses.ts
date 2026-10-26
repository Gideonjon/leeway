/**
 * Server-side address checks per 1Click chain code. These catch the common mistakes
 * (wrong chain, typo, wrong length) before money moves; 1Click and the destination
 * chain remain the final authority.
 */

const EVM = new Set(["eth", "base", "arb", "op", "pol", "bsc", "avax", "gnosis", "bera", "scroll", "monad", "xlayer", "plasma"]);
const B58 = "[1-9A-HJ-NP-Za-km-z]";

const PATTERNS: Record<string, RegExp> = {
  sol: new RegExp(`^${B58}{32,44}$`),
  btc: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  ltc: /^(ltc1[02-9ac-hj-np-z]{11,71}|[LM3][1-9A-HJ-NP-Za-km-z]{26,33})$/,
  doge: /^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/,
  zec: /^(u1[02-9ac-hj-np-z]{100,}|zs1[02-9ac-hj-np-z]{75}|t[13][1-9A-HJ-NP-Za-km-z]{33}|tex1[02-9ac-hj-np-z]{38,})$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  near: /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$|^[0-9a-f]{64}$/,
  xrp: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
  ton: /^([UE]Q[A-Za-z0-9_-]{46}|-?\d:[0-9a-fA-F]{64})$/,
  sui: /^0x[0-9a-fA-F]{64}$/,
  aptos: /^0x[0-9a-fA-F]{1,64}$/,
  stellar: /^G[A-Z2-7]{55}$/,
  cardano: /^addr1[02-9ac-hj-np-z]{50,}$/,
};

const LABELS: Record<string, string> = {
  eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", bsc: "BNB Chain", avax: "Avalanche",
  gnosis: "Gnosis", bera: "Berachain", scroll: "Scroll", monad: "Monad", xlayer: "X Layer", plasma: "Plasma", sol: "Solana",
  btc: "Bitcoin", ltc: "Litecoin", doge: "Dogecoin", zec: "Zcash", tron: "Tron", near: "NEAR", xrp: "XRP Ledger", ton: "TON",
  sui: "Sui", aptos: "Aptos", stellar: "Stellar", cardano: "Cardano",
};
export const chainLabel = (chain: string) => LABELS[chain] ?? chain.toUpperCase();

export function isEvmChainCode(chain: string) {
  return EVM.has(chain);
}

/** Returns an error message a person can act on, or null when the address looks right. */
export function validateAddress(chain: string, address: string, label = chainLabel(chain)): string | null {
  const a = address.trim();
  if (!a) return "Address is missing.";
  if (a.length > 256 || /\s/.test(a)) return "That address has spaces or is too long.";
  if (EVM.has(chain)) return /^0x[0-9a-fA-F]{40}$/.test(a) ? null : `That isn't a ${label} address. It should start with 0x and be 42 characters.`;
  const re = PATTERNS[chain];
  if (re && !re.test(a)) return `That isn't a ${label} address.`;
  return null;
}
