import { listAuditLogs } from "@/lib/repository";
import { ok, handleError, requireSession } from "../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    const url = new URL(req.url);
    return ok(await listAuditLogs(Number(url.searchParams.get("limit") ?? 100)));
  } catch (error) {
    return handleError(error);
  }
}
