import { randomBytes } from "node:crypto";
import {
  buildQuoteRequest,
  findToken,
  isShieldedZcashAddress,
  makeTrackingCode,
  toBaseUnits,
  validateAddress,
  validateGhostRequest,
  ZEC_ASSET_ID,
} from "@leeway/core";
import { errorMessage, fail, guard, json, screen, services, tokens } from "@/lib/server";

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
  const blocked = await guard(req, "ghost", { perMin: 6 });
  if (blocked) return blocked;
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
  const dest = findToken(list, body.destinationAsset)!;
  if (body.destinationAsset === ZEC_ASSET_ID) {
    return fail("To receive ZEC, use Swap and paste a shielded address: it's already private on arrival.");
  }
  if (origin.blockchain === "zec") {
    return fail("Sending from shielded ZEC is already private. Use Swap instead: it's faster and costs less.");
  }
  const recipientErr = validateAddress(dest.blockchain, body.recipient ?? "");
  if (recipientErr) return fail(`Recipient: ${recipientErr}`);
  const refundErr = validateAddress(origin.blockchain, body.refundTo ?? "");
  if (refundErr) return fail(`Refund address: ${refundErr}`);

  let amount: string;
  try {
    amount = toBaseUnits(body.amount ?? "", origin.decimals);
  } catch (e) {
    return fail((e as Error).message);
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
  if (cfg.ghostDailyCapUsd > 0) {
    const used = await db.ghostVolumeSince(new Date(Date.now() - 86_400_000)).catch(() => Infinity);
    if (used + amountUsd > cfg.ghostDailyCapUsd) return fail("Ghost Send has reached today's limit. Try a smaller amount or come back tomorrow.", 429);
  }
  const screened = await screen([body.recipient, body.refundTo]);
  if (screened) return screened;

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
