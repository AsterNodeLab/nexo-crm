import { randomUUID } from "node:crypto";
import { CanonicalMessageSchema, type CanonicalMessage } from "@/lib/contracts";
import { env } from "@/lib/env";
import type { InboundAdapter, OutboundAdapter } from "./types";
import {
  asRecord,
  field,
  readJsonBody,
  readRawBody,
  text,
  verifyMetaSignature,
} from "./support";

const MAX_LENGTH = 1000;

export const instagramInbound: InboundAdapter = {
  async verify(request, config) {
    const url = new URL(request.url);
    if (url.searchParams.get("hub.mode") !== null) {
      const expected = text(config.verifyToken) || env.INSTAGRAM_VERIFY_TOKEN;
      const provided = url.searchParams.get("hub.verify_token") ?? "";
      return Boolean(expected) && url.searchParams.get("hub.mode") === "subscribe" && provided === expected;
    }
    // El route ya leyó el body; `readRawBody` lo recupera de la caché o del clone.
    const raw = await readRawBody(request).catch(() => "");
    return verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), text(config.appSecret) || env.INSTAGRAM_APP_SECRET);
  },

  async parse(request): Promise<CanonicalMessage[]> {
    const payload = asRecord(await readJsonBody(request));
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    const messages: CanonicalMessage[] = [];

    for (const rawEntry of entries) {
      const events = Array.isArray(field(asRecord(rawEntry), "messaging"))
        ? (field(asRecord(rawEntry), "messaging") as unknown[])
        : [];
      for (const rawEvent of events) {
        const event = asRecord(rawEvent);
        const sender = asRecord(field(event, "sender"));
        const senderId = text(field(sender, "id"));
        if (!senderId) continue;
        const content = asRecord(field(event, "message"));
        const timestampMs = Number(text(field(event, "timestamp")));
        const occurredAt =
          Number.isFinite(timestampMs) && timestampMs > 0
            ? new Date(timestampMs).toISOString()
            : undefined;
        const body =
          text(field(content, "text")) ||
          [text(field(asRecord(field(content, "attachments")), "title"))].filter(Boolean).join(" ");

        messages.push(
          CanonicalMessageSchema.parse({
            externalId: `instagram:${text(field(content, "mid")) || randomUUID()}`,
            channel: "instagram",
            direction: "inbound",
            contact: { externalId: senderId },
            conversationExternalId: senderId,
            text: body,
            metadata: { source: "instagram", recipientId: text(field(asRecord(field(event, "recipient")), "id")) },
            ...(occurredAt ? { occurredAt } : {}),
          }),
        );
      }
    }
    return messages;
  },
};

export const instagramOutbound: OutboundAdapter = {
  async send(config, recipient, body) {
    const version = text(config.version) || env.INSTAGRAM_API_VERSION;
    const accessToken = text(config.accessToken) || env.INSTAGRAM_ACCESS_TOKEN;
    if (!accessToken) throw new Error("INSTAGRAM_NOT_CONFIGURED");

    // Graph API rechaza textos de más de 1000 caracteres: recortamos antes de enviar.
    const safeBody = body.length > MAX_LENGTH ? `${body.slice(0, MAX_LENGTH - 1)}…` : body;
    const response = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipient },
        message: { text: safeBody },
        access_token: accessToken,
      }),
    });
    if (!response.ok) throw new Error(`INSTAGRAM_API_${response.status}`);
    const json: unknown = await response.json().catch(() => null);
    return { externalId: text(field(asRecord(json), "message_id")) || randomUUID() };
  },
};
