import { listChannels } from "@/lib/repository";
import { env } from "@/lib/env";
import { ok, handleError, requireSession } from "../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    return ok(await listChannels(env.APP_URL));
  } catch (error) {
    return handleError(error);
  }
}
