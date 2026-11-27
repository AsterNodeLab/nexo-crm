import { env } from "@/lib/env";
import { runTick } from "@/lib/dispatcher";
import { ok, bad, handleError } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Vercel Cron o cron local, una vez por minuto. */
export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${env.CRON_SECRET}`) return bad("UNAUTHORIZED", "Cron no autorizado.", 401);
    return ok(await runTick());
  } catch (error) {
    return handleError(error);
  }
}
