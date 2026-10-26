/**
 * Optional sanctions screening of addresses before Leeway accepts a transfer.
 * Uses the Chainalysis public Sanctions API when LEEWAY_SCREENING_API_KEY is set.
 * Fails closed by default: if screening is configured but unreachable, the transfer
 * is refused rather than waved through.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Screener {
  /** Returns the addresses that are sanctioned (empty when all are clear). */
  check(addresses: string[]): Promise<string[]>;
  enabled: boolean;
}

export class ScreeningUnavailable extends Error {}

export function makeScreener(opts: { apiKey: string; failOpen: boolean; baseUrl?: string; fetchImpl?: FetchLike }): Screener {
  const f = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? "https://public.chainalysis.com/api/v1/address").replace(/\/$/, "");
  if (!opts.apiKey) return { enabled: false, check: async () => [] };
  const cache = new Map<string, { at: number; hit: boolean }>();
  return {
    enabled: true,
    async check(addresses) {
      const hits: string[] = [];
      for (const raw of new Set(addresses.map((a) => a.trim()).filter(Boolean))) {
        const c = cache.get(raw);
        if (c && Date.now() - c.at < 3_600_000) {
          if (c.hit) hits.push(raw);
          continue;
        }
        try {
          const r = await f(`${base}/${encodeURIComponent(raw)}`, { headers: { "X-API-Key": opts.apiKey, accept: "application/json" } });
          if (!r.ok) throw new Error(`screening ${r.status}`);
          const body = (await r.json()) as { identifications?: unknown[] };
          const hit = Array.isArray(body.identifications) && body.identifications.length > 0;
          cache.set(raw, { at: Date.now(), hit });
          if (hit) hits.push(raw);
        } catch (e) {
          if (!opts.failOpen) throw new ScreeningUnavailable(String(e));
        }
      }
      return hits;
    },
  };
}
