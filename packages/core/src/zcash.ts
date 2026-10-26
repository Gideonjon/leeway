/**
 * Backend shielded wallet. Talks the zcashd-compatible JSON-RPC that Zallet implements.
 * Everything Leeway needs from the wallet is behind `ShieldedWallet`, so another backend
 * (zingolib, a custom librustzcash service) can be swapped in without touching the worker.
 */

export interface SendOutput {
  address: string;
  zat: bigint;
  memo?: string;
}

export interface ShieldedWallet {
  /** A fresh transparent receiving address for one Ghost Send leg-1 delivery. */
  newTransparentAddress(): Promise<string>;
  /** The wallet's own unified address that shielded funds are swept into. */
  shieldedAddress(): Promise<string>;
  /** Confirmed balance on one transparent address, in zatoshis. */
  transparentBalance(addr: string, minConf?: number): Promise<bigint>;
  /** Moves everything on a transparent address into the wallet's shielded pool. Returns the txid. */
  shieldFrom(taddr: string, zat: bigint): Promise<string>;
  /** Sends from the wallet's shielded pool. Returns the txid once the operation completes. */
  send(outputs: SendOutput[]): Promise<string>;
  /** Confirmations for a wallet transaction (0 if unconfirmed or unknown). */
  confirmations(txid: string): Promise<number>;
  /** Names of required RPC methods the wallet does not implement. */
  missingMethods(): Promise<string[]>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The wallet reported the send failed before broadcast: nothing left the wallet, safe to retry. */
export class ZcashSendFailed extends Error {}
/** The outcome is unknown (timeout, lost connection): never retry automatically. */
export class ZcashSendUnknown extends Error {}

/** RPC methods Leeway depends on. Checked at worker start-up. */
export const REQUIRED_WALLET_METHODS = [
  "z_getaddressforaccount",
  "z_listunifiedreceivers",
  "listunspent",
  "z_sendmany",
  "z_getoperationstatus",
  "gettransaction",
] as const;

export const zatToZecString = (zat: bigint): string => {
  const whole = zat / 100_000_000n;
  const frac = (zat % 100_000_000n).toString().padStart(8, "0");
  return `${whole}.${frac}`;
};

const zecNumberToZat = (zec: number | string): bigint => {
  const s = typeof zec === "number" ? zec.toFixed(8) : zec;
  const [w, f = ""] = s.split(".");
  return BigInt(w) * 100_000_000n + BigInt((f + "00000000").slice(0, 8));
};

/** Encodes a UTF-8 memo as hex, as z_sendmany expects (max 512 bytes). */
export function memoHex(memo: string): string {
  const bytes = new TextEncoder().encode(memo);
  if (bytes.length > 512) throw new Error("memo exceeds 512 bytes");
  return Buffer.from(bytes).toString("hex");
}

export class ZcashRpcWallet implements ShieldedWallet {
  private id = 0;
  private cachedUa: string | null = null;

  constructor(
    private readonly url: string,
    private readonly user: string,
    private readonly password: string,
    private readonly account: number,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly opPollMs = 1000,
    private readonly opTimeoutMs = 180_000,
  ) {}

  private async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.user) headers.authorization = `Basic ${Buffer.from(`${this.user}:${this.password}`).toString("base64")}`;
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "1.0", id: ++this.id, method, params }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: { result: T; error: { code: number; message: string } | null };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`zcash rpc ${method}: HTTP ${res.status}`);
    }
    if (body.error) throw new Error(`zcash rpc ${method}: [${body.error.code}] ${body.error.message}`);
    return body.result;
  }

  async newTransparentAddress(): Promise<string> {
    // A fresh diversified UA with only a P2PKH receiver, then its transparent receiver.
    const { address } = await this.rpc<{ address: string }>("z_getaddressforaccount", [this.account, ["p2pkh"]]);
    const receivers = await this.rpc<{ p2pkh?: string }>("z_listunifiedreceivers", [address]);
    if (!receivers.p2pkh) throw new Error("wallet did not return a transparent receiver");
    return receivers.p2pkh;
  }

  async shieldedAddress(): Promise<string> {
    if (this.cachedUa) return this.cachedUa;
    const { address } = await this.rpc<{ address: string }>("z_getaddressforaccount", [this.account, ["orchard"]]);
    this.cachedUa = address;
    return address;
  }

  async transparentBalance(addr: string, minConf = 1): Promise<bigint> {
    const utxos = await this.rpc<{ amount: number; address: string }[]>("listunspent", [minConf, 9_999_999, [addr]]);
    return utxos.reduce((sum, u) => sum + zecNumberToZat(u.amount), 0n);
  }

  async shieldFrom(taddr: string, zat: bigint): Promise<string> {
    const ua = await this.shieldedAddress();
    const opid = await this.rpc<string>("z_sendmany", [
      taddr,
      [{ address: ua, amount: Number(zatToZecString(zat)) }],
      1,
      null, // let the wallet apply the ZIP-317 fee
      "AllowRevealedSenders",
    ]);
    return this.awaitOperation(opid);
  }

  async send(outputs: SendOutput[]): Promise<string> {
    if (outputs.length === 0) throw new Error("no outputs");
    const ua = await this.shieldedAddress();
    const amounts = outputs.map((o) => ({
      address: o.address,
      amount: Number(zatToZecString(o.zat)),
      ...(o.memo ? { memo: memoHex(o.memo) } : {}),
    }));
    // Leg-2 deposits are transparent addresses on Zcash, so the policy must allow revealed recipients.
    let opid: string;
    try {
      opid = await this.rpc<string>("z_sendmany", [ua, amounts, 1, null, "AllowRevealedRecipients"]);
    } catch (e) {
      // The RPC rejected the request outright (bad params, insufficient funds): nothing was sent.
      if (/zcash rpc z_sendmany: \[/.test(String(e))) throw new ZcashSendFailed(String(e));
      throw new ZcashSendUnknown(String(e));
    }
    return this.awaitOperation(opid);
  }

  async confirmations(txid: string): Promise<number> {
    try {
      const tx = await this.rpc<{ confirmations?: number }>("gettransaction", [txid]);
      return tx.confirmations ?? 0;
    } catch {
      return 0;
    }
  }

  async missingMethods(): Promise<string[]> {
    const missing: string[] = [];
    for (const m of REQUIRED_WALLET_METHODS) {
      try {
        // Called with no params: an implemented method answers with a parameter error, not "method not found".
        await this.rpc(m, []);
      } catch (e) {
        if (/method not found|-32601|not implemented|unknown method/i.test(String(e))) missing.push(m);
      }
    }
    return missing;
  }

  private async awaitOperation(opid: string): Promise<string> {
    const started = Date.now();
    for (;;) {
      const [op] = await this.rpc<{ status: string; result?: { txid: string }; error?: { message: string } }[]>(
        "z_getoperationstatus",
        [[opid]],
      );
      if (op?.status === "success" && op.result?.txid) {
        await this.rpc("z_getoperationresult", [[opid]]).catch(() => undefined);
        return op.result.txid;
      }
      if (op?.status === "failed") throw new ZcashSendFailed(`zcash operation failed: ${op.error?.message ?? "unknown"}`);
      if (Date.now() - started > this.opTimeoutMs) throw new ZcashSendUnknown(`zcash operation ${opid} timed out`);
      await new Promise((r) => setTimeout(r, this.opPollMs));
    }
  }
}
