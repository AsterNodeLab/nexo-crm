import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { CanonicalMessageSchema, type CanonicalMessage } from "@/lib/contracts";
import { contacts, conversations, messages } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import type { InboundAdapter, OutboundAdapter } from "./types";
import {
  asRecord,
  field,
  readJsonBody,
  readRawBody,
  text,
  verifyMetaSignature,
} from "./support";

const WINDOW_MS = 24 * 60 * 60 * 1000;

function signatureSecret(config: Record<string, unknown>): string {
  return text(config.appSecret) || text(config.accessToken);
}

async function equalsSecret(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  try {
    return safeEqual(a, b);
  } catch {
    return false;
  }
}

export const whatsappInbound: InboundAdapter = {
  async verify(request, config) {
    const url = new URL(request.url);
    const challengeToken = url.searchParams.get("hub.verify_token");
    if (challengeToken !== null || url.searchParams.get("hub.mode") !== null) {
      const expected = text(config.verifyToken) || env.WHATSAPP_VERIFY_TOKEN;
      return (
        url.searchParams.get("hub.mode") === "subscribe" &&
        (await equalsSecret(challengeToken ?? "", expected))
      );
    }
    // Guardamos el body crudo: los routes de Next lo leen antes que el adapter.
    const raw = await readRawBody(request).catch(() => "");
    return verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), signatureSecret(config));
  },

  async parse(request): Promise<CanonicalMessage[]> {
    const payload = asRecord(await readJsonBody(request));
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    const messages: CanonicalMessage[] = [];

    for (const rawEntry of entries) {
      const entry = asRecord(rawEntry);
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const rawChange of changes) {
        const change = asRecord(rawChange);
        const value = asRecord(field(change, "value"));
        const rawMessages = Array.isArray(field(value, "messages"))
          ? (field(value, "messages") as unknown[])
          : [];
        const rawContacts = Array.isArray(field(value, "contacts"))
          ? (field(value, "contacts") as unknown[])
          : [];

        const contacts = new Map<string, ReturnType<typeof asRecord>>();
        for (const rawContact of rawContacts) {
          const contact = asRecord(rawContact);
          contacts.set(text(field(contact, "wa_id")), contact);
        }

        for (const rawMessage of rawMessages) {
          const message = asRecord(rawMessage);
          const waId = text(field(message, "from"));
          const contact = contacts.get(waId) ?? asRecord(null);
          const timestamp = text(field(message, "timestamp"));
          const seconds = Number(timestamp);
          const occurredAt =
            Number.isFinite(seconds) && seconds > 0
              ? new Date(seconds * 1000).toISOString()
              : undefined;
          const type = text(field(message, "type"));
          const body =
            text(field(asRecord(field(message, "text")), "body")) ||
            text(field(asRecord(field(message, "image")), "caption")) ||
            text(field(asRecord(field(message, "document")), "caption")) ||
            "";
          const messageId = text(field(message, "id"));
          if (!waId || !messageId) continue;

          const context = asRecord(field(message, "context"));
          messages.push(
            CanonicalMessageSchema.parse({
              externalId: `whatsapp:${messageId}`,
              channel: "whatsapp",
              direction: "inbound",
              contact: {
                externalId: waId,
                displayName:
                  text(field(asRecord(field(contact, "profile")), "name")) ||
                  text(field(contact, "name")) ||
                  undefined,
                phone: waId,
              },
              conversationExternalId: waId,
              text: body,
              metadata: {
                source: "whatsapp",
                messageType: type || "text",
                contextMessageId: text(field(context, "id")) || undefined,
                businessAccountId:
                  text(field(asRecord(field(value, "metadata")), "business_account_id")) || undefined,
              },
              ...(occurredAt ? { occurredAt } : {}),
            }),
          );
        }
      }
    }
    return messages;
  },
};

/**
 * Meta solo permite mensajes de texto libre dentro de las 24 h posteriores al
 * último mensaje del cliente. Sin plantilla aprobada hay que lanzar un error
 * explícito para que el dispatcher marque el envío como fallido permanente.
 */
export function assertWhatsappWindow(body: string, lastInboundAt: Date | null): void {
  if (!lastInboundAt) return; // Sin historial no podemos afirmar que la ventana cerró.
  if (Date.now() - lastInboundAt.getTime() > WINDOW_MS) {
    throw new Error("WHATSAPP_24H_WINDOW");
  }
  void body;
}

async function lastInboundDate(recipient: string): Promise<Date | null> {
  try {
    const [row] = await db
      .select({ occurredAt: messages.occurredAt, createdAt: messages.createdAt })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(and(eq(contacts.externalId, recipient), eq(messages.direction, "inbound")))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    return row?.occurredAt ?? row?.createdAt ?? null;
  } catch {
    // Sin historial consultable permitimos el envío: no podemos afirmar que la ventana cerró.
    return null;
  }
}

export const whatsappOutbound: OutboundAdapter = {
  async send(config, recipient, body) {
    const version = text(config.version) || env.WHATSAPP_API_VERSION;
    const phoneNumberId = text(config.phoneNumberId) || env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = text(config.accessToken) || env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken) throw new Error("WHATSAPP_NOT_CONFIGURED");

    const templateName = text(config.templateName);
    if (!templateName) await assertWhatsappWindow(body, await lastInboundDate(recipient));

    const payload = templateName
      ? {
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: { name: templateName, language: { code: text(config.templateLanguage) || "es" } },
        }
      : {
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          text: { body },
        };

    const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`WHATSAPP_API_${response.status}`);
    const result = asRecord(json);
    const sent = Array.isArray(field(result, "messages")) ? (field(result, "messages") as unknown[]) : [];
    return { externalId: text(field(asRecord(sent[0]), "id")) || randomUUID() };
  },
};
