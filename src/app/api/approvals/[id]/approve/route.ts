import { getApproval, decideApproval, createOutboundMessage, recordAudit } from "@/lib/repository";
import { ok, bad, body, handleError, requireSession } from "../../../_lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    const { id } = await params;
    const input = await body<{ editedText?: string }>(req);

    const approval = await getApproval(id);
    if (!approval) return bad("NOT_FOUND", "Aprobación no encontrada.", 404);
    if (approval.status !== "pending") return bad("ALREADY_DECIDED", "Esta propuesta ya fue decidida.", 409);
    if (new Date(approval.expiresAt).getTime() < Date.now()) {
      await decideApproval(id, { status: "expired" });
      return bad("EXPIRED", "La propuesta expiró. Genera una nueva.", 410);
    }

    const finalText = (input.editedText ?? approval.editedText ?? approval.proposalText).trim();
    if (!finalText) return bad("EMPTY_TEXT", "La respuesta aprobada no puede estar vacía.", 400);

    await decideApproval(id, { status: "approved", editedText: finalText });
    await createOutboundMessage({
      conversationId: approval.conversationId,
      channelId: approval.channelId,
      recipient: approval.recipient,
      body: finalText,
      authorType: "ai",
      status: "approved",
      aiActionId: approval.aiActionId,
    });
    await recordAudit("dashboard", "approve", id, { edited: Boolean(input.editedText) });
    return ok({ id, status: "approved" });
  } catch (error) {
    return handleError(error);
  }
}
