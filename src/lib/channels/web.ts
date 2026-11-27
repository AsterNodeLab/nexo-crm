import { CanonicalMessageSchema, type CanonicalMessage } from "@/lib/contracts";
import type { InboundAdapter, OutboundAdapter } from "./types";
import { asRecord, readJsonBody, text } from "./support";

/**
 * El widget no tiene secretos: su defensa es la whitelist de orígenes más el
 * token de ingesta Interno. Sin allowlist configurada permitimos todo en local.
 */
function allowedOrigins(config: Record<string, unknown>): string[] {
  const raw = config.allowedOrigins;
  const values = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return values.map((item) => text(item).trim()).filter(Boolean);
}

export const webInbound: InboundAdapter = {
  async verify(request, config) {
    const allowed = allowedOrigins(config);
    if (allowed.length === 0) return true;
    const origin = request.headers.get("origin");
    if (!origin) return false;
    return allowed.includes(origin);
  },

  async parse(request): Promise<CanonicalMessage[]> {
    const input = asRecord(await readJsonBody(request));
    const visitorId = text(input.visitorId) || crypto.randomUUID();
    const message = CanonicalMessageSchema.parse({
      externalId: text(input.externalId) || `web:${crypto.randomUUID()}`,
      channel: "web",
      channelId: text(input.channelId) || undefined,
      direction: "inbound",
      contact: {
        externalId: visitorId,
        displayName: text(input.name) || undefined,
        email: text(input.email) || undefined,
      },
      text: text(input.text),
      conversationExternalId: text(input.conversationId) || undefined,
      metadata: { source: "widget", page: input.page ?? null },
      ...(typeof input.occurredAt === "string" ? { occurredAt: input.occurredAt } : {}),
    });
    return [message];
  },
};

export const webOutbound: OutboundAdapter = {
  /**
   * El widget recibe las respuestas por SSE/REST; no hay proveedor al que
   * llamar. Devolvemos un id estable para que el dispatcher marque el envío.
   */
  async send(_config, _recipient, _body) {
    return { externalId: `web:${crypto.randomUUID()}` };
  },
};
