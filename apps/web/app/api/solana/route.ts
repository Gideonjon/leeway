import { fail, guard } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Read-only Solana RPC proxy for the calls the browser needs to check balances and build a deposit. */
const ALLOWED = new Set(["getLatestBlockhash", "getAccountInfo", "getBalance", "getTokenAccountsByOwner"]);

export async function POST(req: Request) {
  const blocked = await guard(req, "solana", { perMin: 60 });
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { method?: string; params?: unknown[] };
  if (!body.method || !ALLOWED.has(body.method)) return fail("Method not allowed.", 403);
  const url = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: body.method, params: body.params ?? [] }),
    });
    const d = await r.json();
    return new Response(JSON.stringify(d), { status: r.ok ? 200 : 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return fail("Solana RPC unavailable. Try again in a moment.", 502);
  }
}
