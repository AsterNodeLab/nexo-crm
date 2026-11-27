import type { InboundAdapter, OutboundAdapter } from "./types";

/**
 * Fase 2: IMAP IDLE requiere un proceso persistente; en Vercel usar Gmail
 * Pub/Sub. Por eso este adapter nunca se habilita en el MVP y `verify`
 * devuelve false para que el endpoint responda 401 en lugar de fingir éxito.
 */
export const emailInbound: InboundAdapter = {
  async verify() {
    return false;
  },

  async parse(): Promise<never> {
    throw new Error("EMAIL_ADAPTER_PENDING");
  },
};

/**
 * No hay transporte SMTP activo en el MVP: el proyecto no incluye librería de
 * correo y un envío parcial dejaría el mensaje en un estado engañoso. Si se
 * configuran smtpHost/fromAddress, esta función lo advierte en lugar de
 * marcar un envío que no ocurrió.
 */
export const emailOutbound: OutboundAdapter = {
  async send(config) {
    const host = typeof config.smtpHost === "string" ? config.smtpHost : "";
    const reason = host
      ? "SMTP configurado, pero el transporte de correo se habilita en la fase 2"
      : "SMTP sin configurar";
    throw new Error(`EMAIL_ADAPTER_PENDING: ${reason}`);
  },
};
