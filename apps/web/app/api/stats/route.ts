import { cachedStats, errorMessage, fail, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json(await cachedStats());
  } catch (e) {
    return fail(errorMessage(e), 500);
  }
}
