import { listApprovals } from "@/lib/repository";
import { ok, handleError, requireSession } from "../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    const url = new URL(req.url);
    return ok(await listApprovals(url.searchParams.get("status") ?? "pending"));
  } catch (error) {
    return handleError(error);
  }
}
