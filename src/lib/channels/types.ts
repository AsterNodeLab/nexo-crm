import type { CanonicalMessage } from "@/lib/contracts";

/** Adaptador de entrada: convierte un webhook propietario en mensajes canónicos. */
export interface InboundAdapter {
  verify(request: Request, config: Record<string, unknown>): Promise<boolean>;
  parse(request: Request, config: Record<string, unknown>): Promise<CanonicalMessage[]>;
}

/** Adjunto simple compartido por todos los canales de salida. */
export type OutboundAttachment = {
  url: string;
  mime: string;
  name?: string;
};

/** Adaptador de salida: entrega un mensaje y devuelve el id externo del proveedor. */
export interface OutboundAdapter {
  send(
    config: Record<string, unknown>,
    recipient: string,
    body: string,
    attachments?: OutboundAttachment[],
  ): Promise<{ externalId: string }>;
}
