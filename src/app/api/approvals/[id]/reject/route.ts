import { getApproval, decideApproval, recordAudit } from "@/lib/repository";
import { ok, bad, handleError, requireSession } from "../../../_lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    const { id } = await params;
    const approval = await getApproval(id);
    if (!approval) return bad("NOT_FOUND", "Aprobación no encontrada.", 404);
    if (approval.status !== "pending") return bad("ALREADY_DECIDED", "Esta propuesta ya fue decidida.", 409);
    await decideApproval(id, { status: "rejected" });
    await recordAudit("dashboard", "reject", id, {});
    return ok({ id, status: "rejected" });
  } catch (error) {
    return handleError(error);
  }
}
