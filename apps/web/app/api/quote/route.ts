import { buildQuoteRequest, findToken, isShieldedZcashAddress, toBaseUnits } from "@leeway/core";
import { errorMessage, fail, json, services, tokens } from "@/lib/server";

export const dynamic = "force-dynamic";

interface Body {
  originAsset: string;
  destinationAsset: string;
  amount: string; // decimal, in origin units
  recipient?: string;
  refundTo?: string;
  cashbackAddress?: string;
  dry?: boolean;
}

/**
 * Swap quote. `dry: true` previews pricing; otherwise a real quote is created and
 * recorded, and its deposit address returned for the user to pay into.
 */
export async function POST(req: Request) {
  const { cfg, db, oneclick } = services();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail("Send a JSON body.");
  }
  const list = await tokens().catch(() => []);
  const origin = findToken(list, body.originAsset);
  if (!origin) return fail("Pick an asset to send.");
  if (!findToken(list, body.destinationAsset)) return fail("Pick an asset to receive.");

  let amount: string;
  try {
    amount = toBaseUnits(body.amount ?? "", origin.decimals);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (amount === "0") return fail("Enter an amount above zero.");

  const dry = body.dry !== false;
  if (!dry) {
    if (!body.recipient?.trim()) return fail("Add the address that receives the funds.");
    if (!body.refundTo?.trim()) return fail("Add a refund address on the chain you're sending from.");
    if (body.cashbackAddress && !isShieldedZcashAddress(body.cashbackAddress)) {
      return fail("Cashback goes to a shielded Zcash address: one starting with u1 or zs1.");
    }
  }

  try {
    const quote = await oneclick.quote(
      buildQuoteRequest(
        {
          originAsset: body.originAsset,
          destinationAsset: body.destinationAsset,
          amount,
          // 1Click needs syntactically valid addresses even for a dry run.
          recipient: body.recipient?.trim() || "leeway.near",
          refundTo: body.refundTo?.trim() || "leeway.near",
          dry,
        },
        { feeRecipient: cfg.feeRecipient, appFeeBps: cfg.appFeeBps, slippageBps: cfg.slippageBps },
      ),
    );
    if (!dry) await db.insertSwap({ kind: "swap", quote, cashbackAddress: body.cashbackAddress?.trim() || null });
    return json({
      dry,
      depositAddress: quote.quote.depositAddress ?? null,
      depositMemo: quote.quote.depositMemo ?? null,
      amountIn: quote.quote.amountInFormatted,
      amountInUsd: quote.quote.amountInUsd,
      amountOut: quote.quote.amountOutFormatted,
      amountOutUsd: quote.quote.amountOutUsd,
      minAmountOut: quote.quote.minAmountOut,
      timeEstimate: quote.quote.timeEstimate,
      deadline: quote.quote.deadline ?? null,
      cashbackUsd: (Number(quote.quote.amountInUsd) * cfg.cashbackBps) / 10_000,
    });
  } catch (e) {
    return fail(errorMessage(e), 502);
  }
}
