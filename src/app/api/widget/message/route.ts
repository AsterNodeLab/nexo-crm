import { CanonicalMessageSchema, CHANNEL_META } from "@/lib/contracts";
import { getChannelConfig, ingestCanonicalMessage } from "@/lib/repository";
import { ok, bad, handleError } from "../../_lib/http";

export const dynamic = "force-dynamic";

/** Endpoint público del widget: solo acepta el canal web y valida origen. */
export async function POST(req: Request) {
  try {
    const input = await req.json().catch(() => null);
    if (!input || typeof input !== "object") return bad("INVALID_BODY", "JSON inválido.", 400);

    const channel = await getChannelConfig("web");
    const allowed = String(channel?.config.allowedOrigins ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const origin = req.headers.get("origin");
    if (allowed.length > 0 && origin && !allowed.includes(origin)) {
      return bad("ORIGIN_NOT_ALLOWED", "Este dominio no está autorizado para el chat.", 403);
    }

    const parsed = CanonicalMessageSchema.parse({
      externalId: `web:${crypto.randomUUID()}`,
      channel: "web",
      channelId: channel?.id,
      direction: "inbound",
      contact: {
        externalId: String(input.visitorId ?? crypto.randomUUID()),
        displayName: input.name ? String(input.name) : undefined,
        email: input.email ? String(input.email) : undefined,
      },
      text: String(input.text ?? ""),
      metadata: { source: "widget", page: input.page ?? null, userAgent: req.headers.get("user-agent") ?? null },
    });

    const result = await ingestCanonicalMessage(parsed);
    return ok({ ...result, widgetTitle: String(channel?.config.widgetTitle ?? CHANNEL_META.web.fields[1]?.placeholder ?? "Nexo") }, 202);
  } catch (error) {
    return handleError(error);
  }
}
