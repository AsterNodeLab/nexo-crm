import { getConversation, getConversationMessages, updateConversation } from "@/lib/repository";
import { ok, bad, body, handleError, requireSession } from "../../_lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    const { id } = await params;
    const conversation = await getConversation(id);
    if (!conversation) return bad("NOT_FOUND", "Conversación no encontrada.", 404);
    return ok({ conversation, messages: await getConversationMessages(id) });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    const { id } = await params;
    const patch = await body<{ status?: string; priority?: string; assigneeAgentId?: string | null; labels?: string[] }>(req);
    await updateConversation(id, patch);
    return ok(await getConversation(id));
  } catch (error) {
    return handleError(error);
  }
}
