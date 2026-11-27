import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {}, sql: () => ({}) }));

import { whatsappInbound } from "@/lib/channels/whatsapp";

/** Payload con la forma real de WhatsApp Cloud API (entry -> changes -> value). */
const fixture = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "BUSINESS_ACCOUNT_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15551234567",
              phone_number_id: "106540242288320",
              business_account_id: "BUSINESS_ACCOUNT_ID",
            },
            contacts: [
              { profile: { name: "María García" }, wa_id: "5215550102030" },
            ],
            messages: [
              {
                from: "5215550102030",
                id: "wamid.HBgLNTIxNTU1MDEwMjAzM",
                timestamp: "1700000000",
                text: { body: "¿Tenéis disponibilidad para una demo?" },
                type: "text",
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("parser de webhook de WhatsApp", () => {
  it("convierte messages y contactos a CanonicalMessage", async () => {
    const request = new Request("https://nexo.local/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture),
    });

    const messages = await whatsappInbound.parse(request, {});

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      externalId: "whatsapp:wamid.HBgLNTIxNTU1MDEwMjAzM",
      channel: "whatsapp",
      direction: "inbound",
      text: "¿Tenéis disponibilidad para una demo?",
      conversationExternalId: "5215550102030",
      contact: {
        externalId: "5215550102030",
        displayName: "María García",
        phone: "5215550102030",
      },
      occurredAt: "2023-11-14T22:13:20.000Z",
    });
  });
});
