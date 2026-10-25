import { errorMessage, fail, json, tokens } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const list = await tokens();
    return json(
      list
        .filter((t) => t.price > 0)
        .map((t) => ({ assetId: t.assetId, symbol: t.symbol, blockchain: t.blockchain, decimals: t.decimals, price: t.price, contractAddress: t.contractAddress })),
    );
  } catch (e) {
    return fail(`Token list unavailable: ${errorMessage(e)}`, 502);
  }
}
