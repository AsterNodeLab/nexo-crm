import { getConversation, createOutboundMessage } from "@/lib/repository";
import { CanonicalMessageSchema } from "@/lib/contracts";
import { ok, bad, body, handleError, requireSession } from "../../../_lib/http";

/**
 * Respuesta de un humano: se crea como mensaje saliente aprobado y el
 * dispatcher lo envía. La IA nunca llega a este endpoint.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    const { id } = await params;
    const input = await body<{ text: string }>(req);
    const text = CanonicalMessageSchema.shape.text.parse(input.text ?? "");
    if (!text.trim()) return bad("EMPTY_MESSAGE", "Escribe un mensaje antes de enviar.", 400);

    const conversation = await getConversation(id);
    if (!conversation) return bad("NOT_FOUND", "Conversación no encontrada.", 404);

    const outboundId = await createOutboundMessage({
      conversationId: id,
      channelId: conversation.channelId,
      recipient: conversation.contactId,
      body: text.trim(),
      authorType: "human",
      status: "approved",
    });
    return ok({ id: outboundId, queued: true }, 202);
  } catch (error) {
    return handleError(error);
  }
}
