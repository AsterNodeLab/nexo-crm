import { listConversations } from "@/lib/repository";
import { ok, bad, handleError, requireSession } from "../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;

    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? undefined;
    const channel = url.searchParams.get("channel") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 100);

    return ok(await listConversations({ status, channel, limit }));
  } catch (error) {
    return handleError(error);
  }
}
