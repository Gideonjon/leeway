import { buildQuoteRequest, findToken, isEvmChainCode, isShieldedZcashAddress, toBaseUnits, validateAddress } from "@leeway/core";
import { errorMessage, fail, guard, json, screen, services, tokens } from "@/lib/server";

export const dynamic = "force-dynamic";

const DRY_ADDRESSES: Record<string, string> = {
  sol: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  zec: "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs",
  btc: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  ltc: "ltc1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl",
  doge: "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L",
  near: "leeway.near",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  xrp: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  ton: "EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2",
  sui: "0x0000000000000000000000000000000000000000000000000000000000000002",
  aptos: "0x1",
  stellar: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
  cardano: "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x",
};

function dryAddress(chain: string): string {
  if (isEvmChainCode(chain)) return "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  return DRY_ADDRESSES[chain] ?? "leeway.near";
}

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
  // Price previews refresh as people type, so they get a looser limit than real quotes.
  const isDry = req.headers.get("x-leeway-dry") === "1";
  const blocked = await guard(req, isDry ? "preview" : "quote", { perMin: isDry ? 120 : 10 });
  if (blocked) return blocked;
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
  const dest = findToken(list, body.destinationAsset);
  if (!dest) return fail("Pick an asset to receive.");

  let amount: string;
  try {
    amount = toBaseUnits(body.amount ?? "", origin.decimals);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (amount === "0") return fail("Enter an amount above zero.");

  const dry = body.dry !== false;
  // The looser preview limit only ever applies to previews.
  if (isDry !== dry) return fail("Mismatched preview flag.");
  if (!dry) {
    if (!body.recipient?.trim()) return fail("Add the address that receives the funds.");
    if (!body.refundTo?.trim()) return fail("Add a refund address on the chain you're sending from.");
    const recipientErr = validateAddress(findToken(list, body.destinationAsset)!.blockchain, body.recipient);
    if (recipientErr) return fail(`Receiving address: ${recipientErr}`);
    const refundErr = validateAddress(origin.blockchain, body.refundTo);
    if (refundErr) return fail(`Refund address: ${refundErr}`);
    const screened = await screen([body.recipient, body.refundTo]);
    if (screened) return screened;
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
          recipient: body.recipient?.trim() || dryAddress(dest.blockchain),
          refundTo: body.refundTo?.trim() || dryAddress(origin.blockchain),
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
