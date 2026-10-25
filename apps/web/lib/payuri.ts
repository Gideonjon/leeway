/**
 * Payment request URIs: a QR or link that opens the user's own wallet with the
 * address and amount filled in. Zcash uses ZIP-321, which Noir, Zodl, Zingo,
 * YWallet and Cake understand; other chains use their common schemes.
 */

function b64url(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Trims a decimal string to at most `max` places without float rounding. */
function dec(amount: string, max: number) {
  const [w, f = ""] = amount.split(".");
  const frac = f.slice(0, max).replace(/0+$/, "");
  return frac ? `${w}.${frac}` : w;
}

/** ZIP-321. A memo is only allowed when paying a shielded address. */
export function zip321(address: string, amount: string, memo?: string) {
  const params = new URLSearchParams({ amount: dec(amount, 8) });
  let q = params.toString();
  if (memo && /^(u1|zs1)/.test(address)) q += `&memo=${b64url(memo)}`;
  return `zcash:${address}?${q}`;
}

export function paymentUri(chain: string, address: string, amount: string, opts: { mint?: string; symbol?: string } = {}): string | null {
  switch (chain) {
    case "zec":
      return zip321(address, amount);
    case "btc":
      return `bitcoin:${address}?amount=${dec(amount, 8)}`;
    case "ltc":
      return `litecoin:${address}?amount=${dec(amount, 8)}`;
    case "doge":
      return `dogecoin:${address}?amount=${dec(amount, 8)}`;
    case "sol": {
      // Solana Pay transfer request.
      const p = new URLSearchParams({ amount: dec(amount, 9), label: "Leeway" });
      if (opts.mint) p.set("spl-token", opts.mint);
      return `solana:${address}?${p.toString()}`;
    }
    default:
      return null;
  }
}

/** Zcash wallets that open ZIP-321 payment requests. */
export const ZCASH_WALLETS = [
  { id: "noir", name: "Noir", note: "Browser extension" },
  { id: "zodl", name: "Zodl", note: "iOS and Android" },
  { id: "zingo", name: "Zingo", note: "Mobile and desktop" },
  { id: "ywallet", name: "YWallet", note: "Mobile and desktop" },
  { id: "cake", name: "Cake Wallet", note: "Mobile" },
];
