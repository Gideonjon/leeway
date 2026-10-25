import { describe, expect, it } from "vitest";
import { fromBaseUnits, isShieldedZcashAddress, toBaseUnits, zcashAddressKind } from "./assets.js";
import { buildQuoteRequest, OneClickClient, OneClickError } from "./oneclick.js";

describe("buildQuoteRequest", () => {
  const opts = { feeRecipient: "leeway-fees.near", appFeeBps: 50, slippageBps: 100 };
  const input = {
    originAsset: "nep141:base-usdc",
    destinationAsset: "nep141:zec.omft.near",
    amount: "50000000",
    recipient: "u1recipient",
    refundTo: "0xrefund",
    now: new Date("2026-10-25T12:00:00Z"),
  };

  it("attaches the Leeway app fee and uses on-chain deposit and delivery", () => {
    const req = buildQuoteRequest(input, opts);
    expect(req.appFees).toEqual([{ recipient: "leeway-fees.near", fee: 50 }]);
    expect(req.swapType).toBe("EXACT_INPUT");
    expect(req.depositType).toBe("ORIGIN_CHAIN");
    expect(req.recipientType).toBe("DESTINATION_CHAIN");
    expect(req.slippageTolerance).toBe(100);
    expect(req.deadline).toBe("2026-10-25T13:00:00.000Z");
  });

  it("omits the fee when none is configured", () => {
    expect(buildQuoteRequest(input, { ...opts, feeRecipient: "" }).appFees).toBeUndefined();
  });

  it("rejects decimal or zero amounts", () => {
    expect(() => buildQuoteRequest({ ...input, amount: "0.5" }, opts)).toThrow();
    expect(() => buildQuoteRequest({ ...input, amount: "0" }, opts)).toThrow();
  });
});

describe("OneClickClient", () => {
  it("sends the API key and parses the response", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const client = new OneClickClient("https://1click.example/", "key-123", async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ status: "SUCCESS" }), { status: 200 });
    });
    const res = await client.status("0xdep");
    expect(res.status).toBe("SUCCESS");
    expect(seen!.url).toBe("https://1click.example/v0/status?depositAddress=0xdep");
    expect((seen!.init!.headers as Record<string, string>)["X-API-Key"]).toBe("key-123");
  });

  it("surfaces API error messages", async () => {
    const client = new OneClickClient("https://1click.example", "", async () =>
      new Response(JSON.stringify({ message: "amount is too low" }), { status: 400, statusText: "Bad Request" }),
    );
    await expect(client.tokens()).rejects.toBeInstanceOf(OneClickError);
    await expect(client.tokens()).rejects.toThrow(/amount is too low/);
  });
});

describe("assets", () => {
  it("converts between decimal and base units exactly", () => {
    expect(toBaseUnits("1.5", 6)).toBe("1500000");
    expect(toBaseUnits("0.00000001", 8)).toBe("1");
    expect(toBaseUnits("25", 18)).toBe("25000000000000000000");
    expect(() => toBaseUnits("1.1234567", 6)).toThrow();
    expect(fromBaseUnits("1500000", 6)).toBe("1.5");
    expect(fromBaseUnits(100_000_000n, 8)).toBe("1");
  });

  it("recognises Zcash address kinds", () => {
    expect(zcashAddressKind("t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU")).toBe("transparent");
    expect(zcashAddressKind("zs1" + "q".repeat(75))).toBe("sapling");
    expect(zcashAddressKind("u1" + "q".repeat(120))).toBe("unified");
    expect(zcashAddressKind("0xabc")).toBeNull();
    expect(isShieldedZcashAddress("t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU")).toBe(false);
    expect(isShieldedZcashAddress("u1" + "q".repeat(120))).toBe(true);
  });
});
