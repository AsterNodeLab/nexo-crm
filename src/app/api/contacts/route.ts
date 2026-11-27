import { listContacts } from "@/lib/repository";
import { ok, handleError, requireSession } from "../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    return ok(await listContacts(200));
  } catch (error) {
    return handleError(error);
  }
}
