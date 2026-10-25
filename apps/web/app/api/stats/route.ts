import { errorMessage, fail, json, services } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json(await services().db.stats());
  } catch (e) {
    return fail(errorMessage(e), 500);
  }
}
