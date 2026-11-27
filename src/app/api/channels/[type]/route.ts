import { CHANNEL_TYPES } from "@/lib/contracts";
import { upsertChannel } from "@/lib/repository";
import { ok, bad, body, handleError, requireSession } from "../../_lib/http";

export async function PUT(req: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    const { type } = await params;
    if (!CHANNEL_TYPES.includes(type as (typeof CHANNEL_TYPES)[number])) {
      return bad("UNKNOWN_CHANNEL", "Canal desconocido.", 404);
    }
    const input = await body<{ config?: Record<string, unknown> }>(req);
    if (!input.config || typeof input.config !== "object") {
      return bad("INVALID_CONFIG", "Envía un objeto `config`.", 400);
    }
    await upsertChannel(type, input.config);
    return ok({ type, saved: true });
  } catch (error) {
    return handleError(error);
  }
}
