import { randomBytes } from "node:crypto";
import {
  buildQuoteRequest,
  findToken,
  isShieldedZcashAddress,
  makeTrackingCode,
  toBaseUnits,
  validateGhostRequest,
  ZEC_ASSET_ID,
} from "@leeway/core";
import { errorMessage, fail, json, services, tokens } from "@/lib/server";

export const dynamic = "force-dynamic";

interface Body {
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
  refundTo: string;
  cashbackAddress?: string;
}

/** Starts a Ghost Send: leg 1 is quoted into a fresh hop address in the Leeway wallet. */
export async function POST(req: Request) {
  const { cfg, db, oneclick, wallet } = services();
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
  if (body.destinationAsset === ZEC_ASSET_ID) {
    return fail("To receive ZEC, use Swap and paste a shielded address: it's already private on arrival.");
  }

  let amount: string;
  try {
    amount = toBaseUnits(body.amount ?? "", origin.decimals);
  } catch (e) {
    return fail(errorMessage(e));
  }
  const amountUsd = Number(body.amount) * origin.price;
  const cashback = body.cashbackAddress?.trim() || null;
  const invalid = validateGhostRequest({
    recipient: body.recipient ?? "",
    refundTo: body.refundTo ?? "",
    cashbackAddress: cashback,
    amountUsd,
    maxUsd: cfg.ghostMaxUsd,
  });
  if (invalid) return fail(invalid);
  if (cashback && !isShieldedZcashAddress(cashback)) {
    return fail("Cashback goes to a shielded Zcash address: one starting with u1 or zs1.");
  }

  try {
    const hop = await wallet.newTransparentAddress();
    const quote = await oneclick.quote(
      buildQuoteRequest(
        {
          originAsset: body.originAsset,
          destinationAsset: ZEC_ASSET_ID,
          amount,
          recipient: hop,
          refundTo: body.refundTo.trim(),
        },
        { feeRecipient: cfg.feeRecipient, appFeeBps: cfg.appFeeBps, slippageBps: cfg.slippageBps },
      ),
    );
    const deposit = quote.quote.depositAddress!;
    const code = makeTrackingCode((n) => randomBytes(n));
    const ghost = await db.insertGhost({
      code,
      state: "awaiting_deposit",
      originAsset: body.originAsset,
      destinationAsset: body.destinationAsset,
      recipient: body.recipient.trim(),
      refundTo: body.refundTo.trim(),
      cashbackAddress: cashback,
      leg1DepositAddress: deposit,
      hopTransparentAddress: hop,
      receivedZat: null,
      shieldTxid: null,
      releaseAt: null,
      leg2DepositAddress: null,
      leg2Txid: null,
      amountInUsd: quote.quote.amountInUsd,
      error: null,
    });
    await db.insertSwap({ kind: "ghost_leg1", quote, cashbackAddress: cashback, parentId: ghost.id });

    return json({
      code,
      depositAddress: deposit,
      depositMemo: quote.quote.depositMemo ?? null,
      amountIn: quote.quote.amountInFormatted,
      amountInUsd: quote.quote.amountInUsd,
      deadline: quote.quote.deadline ?? null,
    });
  } catch (e) {
    return fail(errorMessage(e), 502);
  }
}
