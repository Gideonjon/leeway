/** Client-safe chain metadata for 1Click blockchain codes. */

export const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum", base: "Base", arb: "Arbitrum", sol: "Solana", btc: "Bitcoin", zec: "Zcash", near: "NEAR",
  bsc: "BNB Chain", pol: "Polygon", tron: "Tron", op: "Optimism", avax: "Avalanche", ton: "TON", sui: "Sui",
  doge: "Dogecoin", xrp: "XRP Ledger", ltc: "Litecoin", gnosis: "Gnosis", bera: "Berachain", stellar: "Stellar",
  aptos: "Aptos", cardano: "Cardano", monad: "Monad", bch: "Bitcoin Cash", scroll: "Scroll", starknet: "Starknet",
  aleo: "Aleo", xlayer: "X Layer", plasma: "Plasma", movement: "Movement", dash: "Dash", hypercore: "Hyperliquid",
  hlevm: "HyperEVM",
};
export const chainName = (c: string) => CHAIN_NAMES[c] ?? c.toUpperCase();

/** EVM chain ids, for paying a deposit straight from a connected wallet. */
export const EVM_CHAIN_IDS: Record<string, number> = {
  eth: 1, base: 8453, arb: 42161, op: 10, pol: 137, bsc: 56, avax: 43114, gnosis: 100, bera: 80094,
  scroll: 534352, monad: 143, xlayer: 196, plasma: 9745,
};
export const isEvmChain = (c: string) => c in EVM_CHAIN_IDS;

const CHAIN_ICONS = new Set([
  "aptos", "arb", "avax", "base", "bera", "bsc", "btc", "cardano", "eth", "gnosis", "ltc", "monad", "movement", "near", "op",
  "plasma", "pol", "scroll", "sol", "starknet", "stellar", "sui", "ton", "tron", "xlayer", "xrp", "zec", "dash", "doge",
  "bch", "aleo", "hypercore", "hlevm",
]);
export const chainIcon = (c: string) => (CHAIN_ICONS.has(c) ? `/icons/c/${c}.svg` : null);
export const tokenIcon = (symbol: string) => `/icons/t/${symbol.toUpperCase().replace(/[^A-Z0-9.]/g, "")}.svg`;

/** Chains shown first in the picker rail. */
export const CHAIN_ORDER = ["eth", "base", "sol", "btc", "zec", "arb", "op", "bsc", "pol", "near", "tron", "avax", "ton", "sui", "xrp", "doge", "ltc"];

export const shortAddr = (a: string, head = 6, tail = 4) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);

/** Rough address-format check per chain, for friendly hints before 1Click validates. */
export function addressHint(chain: string, addr: string): string | null {
  const a = addr.trim();
  if (!a) return null;
  if (isEvmChain(chain)) return /^0x[0-9a-fA-F]{40}$/.test(a) ? null : `That isn't a ${chainName(chain)} address. It should start with 0x.`;
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? null : "That isn't a Solana address.";
  if (chain === "btc") return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a) ? null : "That isn't a Bitcoin address.";
  if (chain === "zec") return /^(u1|zs1|t1|t3|tex1)/.test(a) ? null : "That isn't a Zcash address.";
  if (chain === "near") return /^([a-z0-9_-]+\.)*[a-z0-9_-]+(\.near)?$|^[0-9a-f]{64}$/.test(a) ? null : "That isn't a NEAR account.";
  if (chain === "tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) ? null : "That isn't a Tron address.";
  return null;
}
