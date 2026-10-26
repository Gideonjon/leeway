/**
 * Minimal typed client for the NEAR Intents 1Click Swap API.
 * Spec: https://1click.chaindefuser.com/docs/v0/openapi.yaml
 */

export type SwapType = "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT";
export type AddressType = "ORIGIN_CHAIN" | "INTENTS";
export type RecipientType = "DESTINATION_CHAIN" | "INTENTS";

export interface Token {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt?: string;
  contractAddress?: string;
}

export interface QuoteRequest {
  dry: boolean;
  swapType: SwapType;
  slippageTolerance: number;
  originAsset: string;
  depositType: AddressType;
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: AddressType;
  recipient: string;
  recipientType: RecipientType;
  deadline: string;
  appFees?: { recipient: string; fee: number }[];
  referral?: string;
  quoteWaitingTimeMs?: number;
}

export interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeEstimate: number;
}

export interface QuoteResponse {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Quote;
}

export type SwapStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export const TERMINAL_STATUSES: ReadonlySet<SwapStatus> = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

export interface StatusResponse {
  status: SwapStatus;
  updatedAt?: string;
  swapDetails?: {
    amountIn?: string;
    amountInUsd?: string;
    amountOut?: string;
    amountOutUsd?: string;
    originChainTxHashes?: { hash: string; explorerUrl?: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl?: string }[];
    refundedAmount?: string;
  };
}

export class OneClickError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "OneClickError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class OneClickClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, attempt = 0): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      // Network error or timeout. Reads are safe to retry; a quote is too (it only reserves an address).
      if (attempt < 2) return this.request(method, path, body, attempt + 1);
      throw new OneClickError(`1Click ${method} ${path} failed: unreachable (${String(e)})`, 503, null);
    } finally {
      clearTimeout(timer);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 5_000)));
      return this.request(method, path, body, attempt + 1);
    }
    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const msg = (parsed as { message?: string } | undefined)?.message ?? `${res.status} ${res.statusText}`;
      throw new OneClickError(`1Click ${method} ${path} failed: ${msg}`, res.status, parsed);
    }
    return parsed as T;
  }

  tokens(): Promise<Token[]> {
    return this.request("GET", "/v0/tokens");
  }

  quote(req: QuoteRequest): Promise<QuoteResponse> {
    return this.request("POST", "/v0/quote", req);
  }

  status(depositAddress: string, depositMemo?: string): Promise<StatusResponse> {
    const q = new URLSearchParams({ depositAddress });
    if (depositMemo) q.set("depositMemo", depositMemo);
    return this.request("GET", `/v0/status?${q.toString()}`);
  }

  /** Optional: tells 1Click about a deposit tx so it starts sooner. */
  submitDeposit(txHash: string, depositAddress: string): Promise<unknown> {
    return this.request("POST", "/v0/deposit/submit", { txHash, depositAddress });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export interface BuildQuoteInput {
  originAsset: string;
  destinationAsset: string;
  /** Integer string in the origin asset's smallest unit. */
  amount: string;
  recipient: string;
  refundTo: string;
  dry?: boolean;
  /** Minutes until 1Click starts refunding an unfunded quote. */
  deadlineMinutes?: number;
  now?: Date;
}

/** Builds a Leeway quote: always EXACT_INPUT, on-chain deposit and delivery, with the Leeway app fee attached. */
export function buildQuoteRequest(
  input: BuildQuoteInput,
  opts: { feeRecipient: string; appFeeBps: number; slippageBps: number },
): QuoteRequest {
  if (!/^\d+$/.test(input.amount) || input.amount === "0") {
    throw new Error("amount must be a positive integer string in base units");
  }
  const now = input.now ?? new Date();
  const deadline = new Date(now.getTime() + (input.deadlineMinutes ?? 60) * 60_000).toISOString();
  const req: QuoteRequest = {
    dry: input.dry ?? false,
    swapType: "EXACT_INPUT",
    slippageTolerance: opts.slippageBps,
    originAsset: input.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: input.destinationAsset,
    amount: input.amount,
    refundTo: input.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: input.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline,
    referral: "leeway",
  };
  if (opts.feeRecipient && opts.appFeeBps > 0) {
    req.appFees = [{ recipient: opts.feeRecipient, fee: opts.appFeeBps }];
  }
  return req;
}
