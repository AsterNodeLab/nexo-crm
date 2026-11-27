import { Globe2, Instagram, Mail, MessageCircle, Send, type LucideIcon } from "lucide-react";
import type { ChannelType } from "@/lib/contracts";

const ICONS: Record<ChannelType, LucideIcon> = {
  web: Globe2,
  telegram: Send,
  email: Mail,
  whatsapp: MessageCircle,
  instagram: Instagram,
};

type Props = {
  channel: ChannelType;
  className?: string;
  size?: number;
};

export function ChannelIcon({ channel, className, size = 20 }: Props) {
  const Icon = ICONS[channel];
  return <Icon size={size} strokeWidth={1.75} className={className} aria-hidden="true" />;
}
