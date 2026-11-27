import { describe, expect, it } from "vitest";
import { CanonicalMessageSchema, type CanonicalMessage } from "@/lib/contracts";

/**
 * Contrato de idempotencia de `ingestCanonicalMessage`. La implementación real
 * vive en repository.ts (otro módulo); aquí documentamos con un fake en memoria
 * el comportamiento que el núcleo y los adapters dan por seguro: un mismo
 * externalId no crea dos mensajes ni dos conversaciones.
 */
function createIngestFake() {
  const byExternalId = new Map<string, { conversationId: string; messageId: string }>();
  return async function ingest(message: CanonicalMessage) {
    const parsed = CanonicalMessageSchema.parse(message);
    const key = `${parsed.channel}:${parsed.externalId}`;
    const existing = byExternalId.get(key);
    if (existing) return { ...existing, created: false };
    const created = {
      conversationId: `conv-${byExternalId.size + 1}`,
      messageId: `msg-${byExternalId.size + 1}`,
    };
    byExternalId.set(key, created);
    return { ...created, created: true };
  };
}

const message = CanonicalMessageSchema.parse({
  externalId: "telegram:123:456",
  channel: "telegram",
  direction: "inbound",
  contact: { externalId: "123", displayName: "Ana" },
  conversationExternalId: "123",
  text: "Hola, ¿podéis ayudarme?",
});

describe("ingestCanonicalMessage (contrato de dedupe)", () => {
  it("la segunda entrega del mismo webhook reutiliza conversación y mensaje", async () => {
    const ingest = createIngestFake();
    const first = await ingest(message);
    const second = await ingest(message);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.messageId).toBe(first.messageId);
  });

  it("un mensaje distinto crea una entrada nueva", async () => {
    const ingest = createIngestFake();
    await ingest(message);
    const other = await ingest({
      ...message,
      externalId: "telegram:123:457",
      text: "Gracias",
    });
    expect(other.created).toBe(true);
  });
});
