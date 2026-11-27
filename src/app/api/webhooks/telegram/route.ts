import { getChannelConfig } from "@/lib/repository";
import { getInboundAdapter, handleTelegramCallback } from "@/lib/channels";
import { ingestCanonicalMessage } from "@/lib/repository";
import { ok, bad, handleError } from "../../_lib/http";

export const dynamic = "force-dynamic";

/** Bot API llama a este endpoint. El secreto se configura con setWebhook. */
export async function POST(req: Request) {
  try {
    const channel = await getChannelConfig("telegram");
    if (!channel) return bad("CHANNEL_NOT_CONFIGURED", "Telegram no está configurado.", 503);

    const adapter = getInboundAdapter("telegram");
    if (!(await adapter.verify(req, channel.config))) {
      return bad("INVALID_SIGNATURE", "Firma de Telegram inválida.", 401);
    }

    const payload = (await req.json()) as Record<string, unknown>;
    if (payload.callback_query) {
      await handleTelegramCallback(payload.callback_query as Record<string, unknown>);
      return ok({ handled: "callback_query" });
    }

    const messages = await adapter.parse(req, channel.config);
    for (const message of messages) {
      await ingestCanonicalMessage(message);
    }
    return ok({ ingested: messages.length });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET() {
  return ok({ endpoint: "telegram", status: "ready" });
}
