import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {}, sql: () => ({}) }));

import { verifyMetaSignature } from "@/lib/channels/support";

const secret = "app-secret-de-prueba";
const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

function signature(value: string, key: string): string {
  return `sha256=${createHmac("sha256", key).update(value).digest("hex")}`;
}

describe("firma HMAC de Meta", () => {
  it("acepta una firma válida calculada sobre el body crudo", () => {
    expect(verifyMetaSignature(raw, signature(raw, secret), secret)).toBe(true);
  });

  it("rechaza una firma de otro secreto", () => {
    expect(verifyMetaSignature(raw, signature(raw, "otro-secreto"), secret)).toBe(false);
  });

  it("rechaza una firma sobre un body modificado", () => {
    expect(verifyMetaSignature(`${raw} `, signature(raw, secret), secret)).toBe(false);
  });

  it("rechaza cabeceras ausentes o secretos vacíos", () => {
    expect(verifyMetaSignature(raw, null, secret)).toBe(false);
    expect(verifyMetaSignature(raw, signature(raw, secret), "")).toBe(false);
  });
});
