// Local stand-ins for the 1Click API (port 4010) and a Zallet/zcashd JSON-RPC wallet (port 4020).
// For end-to-end tests only. Control endpoints let a test script advance swap states and confirmations.
import http from "node:http";
import { randomBytes } from "node:crypto";

const TOKENS = [
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, blockchain: "base", symbol: "USDC", price: 1 },
  { assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 150 },
  { assetId: "nep141:zec.omft.near", decimals: 8, blockchain: "zec", symbol: "ZEC", price: 500 },
];

const swaps = new Map(); // depositAddress -> { status, req, amountInUsd }
const wallet = { taddrBalances: new Map(), txs: new Map(), sends: [], ops: new Map() };

const body = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s ? JSON.parse(s) : {})); });
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const hex = (n) => randomBytes(n).toString("hex");

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/v0/tokens") return send(res, 200, TOKENS);
  if (req.method === "POST" && url.pathname === "/v0/quote") {
    const q = await body(req);
    const o = TOKENS.find((t) => t.assetId === q.originAsset), d = TOKENS.find((t) => t.assetId === q.destinationAsset);
    if (!o || !d) return send(res, 400, { message: "unknown asset" });
    const inUsd = (Number(q.amount) / 10 ** o.decimals) * o.price;
    const fee = (q.appFees ?? []).reduce((s, f) => s + f.fee, 0) / 10_000;
    const outAmt = (inUsd * (1 - fee)) / d.price;
    const dep = o.blockchain === "zec" ? `t1${hex(16)}` : `0x${hex(20)}`;
    const quote = {
      amountIn: q.amount, amountInFormatted: String(Number(q.amount) / 10 ** o.decimals), amountInUsd: inUsd.toFixed(2),
      minAmountIn: q.amount, amountOut: String(Math.floor(outAmt * 10 ** d.decimals)), amountOutFormatted: outAmt.toFixed(6),
      amountOutUsd: (outAmt * d.price).toFixed(2), minAmountOut: "0", timeEstimate: 60,
      ...(q.dry ? {} : { depositAddress: dep, deadline: q.deadline }),
    };
    if (!q.dry) swaps.set(dep, { status: "PENDING_DEPOSIT", req: q, amountInUsd: quote.amountInUsd, amountOut: quote.amountOut });
    return send(res, 200, { correlationId: hex(8), timestamp: new Date().toISOString(), signature: "sig", quoteRequest: q, quote });
  }
  if (req.method === "GET" && url.pathname === "/v0/status") {
    const s = swaps.get(url.searchParams.get("depositAddress"));
    if (!s) return send(res, 404, { message: "not found" });
    return send(res, 200, { status: s.status, swapDetails: { amountInUsd: s.amountInUsd, amountOut: s.amountOut } });
  }
  if (req.method === "POST" && url.pathname === "/v0/deposit/submit") return send(res, 200, {});
  // control: settle a swap. If it delivers ZEC to a transparent address, credit the mock wallet.
  if (req.method === "POST" && url.pathname === "/control/settle") {
    const { depositAddress, status } = await body(req);
    const s = swaps.get(depositAddress);
    s.status = status;
    if (status === "SUCCESS" && s.req.destinationAsset === "nep141:zec.omft.near" && s.req.recipient.startsWith("t1")) {
      wallet.taddrBalances.set(s.req.recipient, BigInt(s.amountOut));
    }
    return send(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/control/swaps") return send(res, 200, [...swaps.entries()].map(([k, v]) => ({ depositAddress: k, ...v })));
  send(res, 404, { message: "no route" });
}).listen(4010);

// ---------------------------------------------------------------- zcash RPC
const zec = (zat) => Number(zat) / 1e8;
http.createServer(async (req, res) => {
  const { method, params, id } = await body(req);
  const ok = (result) => send(res, 200, { result, error: null, id });
  const opid = () => { const o = `opid-${hex(6)}`; const txid = hex(32); wallet.txs.set(txid, 0); wallet.ops.set(o, txid); return [o, txid]; };
  switch (method) {
    case "z_getaddressforaccount": return ok({ address: params[1]?.[0] === "p2pkh" ? `u1t${hex(8)}` : `u1${"q".repeat(120)}` });
    case "z_listunifiedreceivers": return ok({ p2pkh: `t1${hex(16)}` });
    case "listunspent": {
      const bal = wallet.taddrBalances.get(params[2][0]) ?? 0n;
      return ok(bal > 0n ? [{ address: params[2][0], amount: zec(bal) }] : []);
    }
    case "z_sendmany": {
      const [o, txid] = opid();
      wallet.sends.push({ from: params[0], amounts: params[1], policy: params[4], txid });
      if (params[0].startsWith("t1")) wallet.taddrBalances.set(params[0], 0n);
      return ok(o);
    }
    case "z_getoperationstatus": return ok(params[0].map((o) => ({ id: o, status: "success", result: { txid: wallet.ops.get(o) } })));
    case "z_getoperationresult": return ok([]);
    case "gettransaction": return ok({ confirmations: wallet.txs.get(params[0]) ?? 0 });
    case "control_confirm_all": for (const k of wallet.txs.keys()) wallet.txs.set(k, 3); return ok(true);
    case "control_sends": return ok(wallet.sends);
    default: return send(res, 200, { result: null, error: { code: -32601, message: `no ${method}` }, id });
  }
}).listen(4020);

console.log("mock 1Click on :4010, mock zcash rpc on :4020");
