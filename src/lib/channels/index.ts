import type { ChannelType } from "@/lib/contracts";
import type { InboundAdapter, OutboundAdapter, OutboundAttachment } from "./types";
import { webInbound, webOutbound } from "./web";
import { telegramInbound, telegramOutbound } from "./telegram";
import { whatsappInbound, whatsappOutbound } from "./whatsapp";
import { instagramInbound, instagramOutbound } from "./instagram";
import { emailInbound, emailOutbound } from "./email";

const inboundAdapters: Record<ChannelType, InboundAdapter> = {
  web: webInbound,
  telegram: telegramInbound,
  whatsapp: whatsappInbound,
  instagram: instagramInbound,
  email: emailInbound,
};

const outboundAdapters: Record<ChannelType, OutboundAdapter> = {
  web: webOutbound,
  telegram: telegramOutbound,
  whatsapp: whatsappOutbound,
  instagram: instagramOutbound,
  email: emailOutbound,
};

export function getInboundAdapter(type: string): InboundAdapter {
  const adapter = inboundAdapters[type as ChannelType];
  if (!adapter) throw new Error(`UNSUPPORTED_CHANNEL:${type}`);
  return adapter;
}

export function getOutboundAdapter(type: string): OutboundAdapter {
  const adapter = outboundAdapters[type as ChannelType];
  if (!adapter) throw new Error(`UNSUPPORTED_CHANNEL:${type}`);
  return adapter;
}

export async function sendViaChannel(
  type: string,
  config: Record<string, unknown>,
  recipient: string,
  body: string,
  attachments?: OutboundAttachment[],
): Promise<{ externalId: string }> {
  return getOutboundAdapter(type).send(config, recipient, body, attachments);
}

export type { InboundAdapter, OutboundAdapter, OutboundAttachment };
export {
  handleTelegramCallback,
  handleTelegramText,
  notifyTelegramApproval,
} from "./telegram";
export { verifyMetaSignature } from "./support";
export { assertWhatsappWindow } from "./whatsapp";
