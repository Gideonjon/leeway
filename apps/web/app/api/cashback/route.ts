import { isShieldedZcashAddress } from "@leeway/core";
import { errorMessage, fail, json, services } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Cashback earned by one shielded address: pending and paid, in zatoshis. */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address")?.trim() ?? "";
  if (!isShieldedZcashAddress(address)) return fail("Paste the shielded address you used for cashback (u1… or zs1…).");
  try {
    return json(await services().db.cashbackForAddress(address));
  } catch (e) {
    return fail(errorMessage(e), 500);
  }
}
