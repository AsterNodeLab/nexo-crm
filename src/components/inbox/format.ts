import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { ConversationStatus, Priority } from "@/lib/contracts";
import type { Tone } from "../ui";

export function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "sin fecha";
  return formatDistanceToNow(date, { addSuffix: true, locale: es });
}

export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "HH:mm", { locale: es });
}

export const STATUS_LABEL: Record<ConversationStatus, string> = {
  open: "Abierta",
  pending: "Pendiente",
  resolved: "Resuelta",
};

export const STATUS_TONE: Record<ConversationStatus, Tone> = {
  open: "success",
  pending: "warning",
  resolved: "neutral",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
};
