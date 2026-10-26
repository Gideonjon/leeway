import { describe, expect, it } from "vitest";
import { validateAddress } from "./addresses.js";
import { loadConfig, productionProblems } from "./config.js";
import { makeScreener, ScreeningUnavailable } from "./screening.js";

describe("validateAddress", () => {
  it("accepts real formats per chain", () => {
    expect(validateAddress("base", "0x2527D02599Ba641c19FEa793cD0F167589a0f10D")).toBeNull();
    expect(validateAddress("sol", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBeNull();
    expect(validateAddress("btc", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBeNull();
    expect(validateAddress("zec", "t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU")).toBeNull();
    expect(validateAddress("tron", "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7")).toBeNull();
    expect(validateAddress("near", "alice.near")).toBeNull();
  });
  it("rejects wrong-chain addresses with a usable message", () => {
    expect(validateAddress("sol", "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", "Solana")).toMatch(/Solana/);
    expect(validateAddress("eth", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "Ethereum")).toMatch(/0x/);
    expect(validateAddress("btc", "0xabc")).not.toBeNull();
    expect(validateAddress("base", "")).toMatch(/missing/);
    expect(validateAddress("base", "0x2527D02599Ba641c19FEa793cD0F167589a0f10D extra")).toMatch(/spaces/);
  });
});

describe("productionProblems", () => {
  it("lists what's missing for a real launch", () => {
    const cfg = loadConfig({ NODE_ENV: "production" });
    const p = productionProblems(cfg, "worker");
    expect(p.join(" ")).toMatch(/DATABASE_URL/);
    expect(p.join(" ")).toMatch(/ONECLICK_API_KEY/);
    expect(p.join(" ")).toMatch(/LEEWAY_FEE_RECIPIENT/);
    expect(p.join(" ")).toMatch(/ZCASH_RPC_USER/);
  });
  it("passes a complete config", () => {
    const cfg = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x",
      ONECLICK_API_KEY: "k",
      LEEWAY_FEE_RECIPIENT: "fees.near",
      ZCASH_RPC_USER: "u",
      ZCASH_RPC_PASSWORD: "p",
    });
    expect(productionProblems(cfg, "worker")).toEqual([]);
  });
  it("rejects nonsense fees", () => {
    expect(() => loadConfig({ LEEWAY_APP_FEE_BPS: "5000" })).toThrow();
    expect(() => loadConfig({ LEEWAY_APP_FEE_BPS: "10", LEEWAY_CASHBACK_BPS: "20" })).toThrow();
  });
});

describe("screening", () => {
  const sanctioned = "0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a";
  const fake = (fail = false) =>
    (async (url: string) => {
      if (fail) throw new Error("down");
      const hit = url.toLowerCase().endsWith(sanctioned);
      return new Response(JSON.stringify({ identifications: hit ? [{ category: "sanctions" }] : [] }), { status: 200 });
    }) as typeof fetch;

  it("is off without a key", async () => {
    const s = makeScreener({ apiKey: "", failOpen: false });
    expect(s.enabled).toBe(false);
    expect(await s.check([sanctioned])).toEqual([]);
  });
  it("flags sanctioned addresses", async () => {
    const s = makeScreener({ apiKey: "k", failOpen: false, fetchImpl: fake() });
    expect(await s.check([sanctioned, "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"])).toEqual([sanctioned]);
  });
  it("fails closed by default when the API is down", async () => {
    const s = makeScreener({ apiKey: "k", failOpen: false, fetchImpl: fake(true) });
    await expect(s.check(["0xabc"])).rejects.toBeInstanceOf(ScreeningUnavailable);
  });
  it("can fail open when configured", async () => {
    const s = makeScreener({ apiKey: "k", failOpen: true, fetchImpl: fake(true) });
    expect(await s.check(["0xabc"])).toEqual([]);
  });
});
