/**
 * Contrato único del proyecto. Este archivo es la frontera entre el núcleo,
 * los adapters de canal, la API HTTP y la interfaz. Si cambias aquí, cambia
 * en todos lados. Los agentes que construyen módulos deben importar de aquí.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Canales
// ---------------------------------------------------------------------------

export const CHANNEL_TYPES = ["web", "telegram", "email", "whatsapp", "instagram"] as const;
export const ChannelTypeSchema = z.enum(CHANNEL_TYPES);
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export type ChannelField = {
  key: string;
  label: string;
  placeholder: string;
  help: string;
  secret?: boolean;
};

/** Metadatos que alimentan la pantalla /canales. No contiene secretos. */
export const CHANNEL_META: Record<
  ChannelType,
  { label: string; description: string; fields: ChannelField[]; webhookPath?: string }
> = {
  web: {
    label: "Chat web",
    description: "Widget embebible en tu sitio. Sin credenciales externas: solo copies un script.",
    fields: [
      { key: "allowedOrigins", label: "Orígenes permitidos", placeholder: "https://tudominio.com", help: "Separa varios con coma. Deja vacío para permitir todos en desarrollo." },
      { key: "widgetTitle", label: "Título del widget", placeholder: "¿En qué podemos ayudarte?", help: "Texto que ve el visitante al abrir el chat." },
    ],
  },
  telegram: {
    label: "Telegram",
    description: "Recibe mensajes y aprueba respuestas de la IA desde el bot.",
    webhookPath: "/api/webhooks/telegram",
    fields: [
      { key: "botToken", label: "Bot token", placeholder: "123456:ABC...", help: "Lo obtienes con @BotFather. Se guarda cifrado.", secret: true },
      { key: "approverChatIds", label: "Chat IDs con permiso de aprobación", placeholder: "123456789,987654321", help: "Whitelist obligatoria. Solo estos chats pueden aprobar envíos." },
      { key: "verifyToken", label: "Webhook secret", placeholder: "cadena-aleatoria", help: "Se usa para validar el header X-Telegram-Bot-Api-Secret-Token.", secret: true },
    ],
  },
  email: {
    label: "Correo",
    description: "Bandeja IMAP/SMTP o Gmail. Configuración avanzada en la fase 2.",
    fields: [
      { key: "imapHost", label: "IMAP host", placeholder: "imap.tudominio.com", help: "Servidor de entrada." },
      { key: "imapUser", label: "IMAP usuario", placeholder: "soporte@tudominio.com", help: "Cuenta del buzón." },
      { key: "imapPass", label: "IMAP contraseña", placeholder: "••••••••", help: "Contraseña de aplicación. Se guarda cifrada.", secret: true },
      { key: "smtpHost", label: "SMTP host", placeholder: "smtp.tudominio.com", help: "Servidor de salida." },
      { key: "fromAddress", label: "Dirección de envío", placeholder: "Nexo <soporte@tudominio.com>", help: "Debe coincidir con el dominio autenticado (SPF/DKIM/DMARC)." },
    ],
  },
  whatsapp: {
    label: "WhatsApp Business",
    description: "Meta Cloud API. Requiere verificación de negocio y plantillas aprobadas.",
    webhookPath: "/api/webhooks/whatsapp",
    fields: [
      { key: "phoneNumberId", label: "Phone number ID", placeholder: "1234567890", help: "Meta Business → WhatsApp → Configuration." },
      { key: "businessAccountId", label: "Business account ID", placeholder: "1234567890", help: "ID de la cuenta de WhatsApp Business." },
      { key: "accessToken", label: "Access token", placeholder: "EAAG...", help: "Token de sistema con permisos whatsapp_business_messaging.", secret: true },
      { key: "appSecret", label: "App secret", placeholder: "••••••••", help: "Se usa para verificar la firma X-Hub-Signature-256 de cada webhook.", secret: true },
      { key: "verifyToken", label: "Verify token", placeholder: "cadena-aleatoria", help: "El mismo que registras en la configuración del webhook en Meta.", secret: true },
    ],
  },
  instagram: {
    label: "Instagram DM",
    description: "Instagram Graph API. La cuenta debe ser Business y estar vinculada a una Page.",
    webhookPath: "/api/webhooks/instagram",
    fields: [
      { key: "appId", label: "App ID", placeholder: "1234567890", help: "ID de la app de Meta." },
      { key: "appSecret", label: "App secret", placeholder: "••••••••", help: "Se usa para verificar la firma X-Hub-Signature-256.", secret: true },
      { key: "accessToken", label: "Access token de página", placeholder: "EAAG...", help: "Token con permisos instagram_manage_messages y pages_manage_metadata.", secret: true },
      { key: "verifyToken", label: "Verify token", placeholder: "cadena-aleatoria", help: "Token de verificación del webhook.", secret: true },
    ],
  },
};

// ---------------------------------------------------------------------------
// Mensaje canónico: todo adapter convierte su payload a esta forma
// ---------------------------------------------------------------------------

export const CanonicalMessageSchema = z.object({
  externalId: z.string().min(1),
  channel: ChannelTypeSchema,
  channelId: z.string().uuid().optional(),
  direction: z.enum(["inbound", "outbound"]),
  contact: z.object({
    externalId: z.string().min(1),
    displayName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    avatarUrl: z.string().url().optional(),
  }),
  conversationExternalId: z.string().optional(),
  threadKey: z.string().optional(),
  text: z.string().default(""),
  attachments: z
    .array(z.object({ url: z.string(), mime: z.string(), name: z.string().optional() }))
    .default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().datetime().optional(),
});

export type CanonicalMessage = z.infer<typeof CanonicalMessageSchema>;

// ---------------------------------------------------------------------------
// Formatos que consume la interfaz (siempre { data: ... })
// ---------------------------------------------------------------------------

export type ConversationStatus = "open" | "pending" | "resolved";
export type Priority = "low" | "normal" | "high" | "urgent";

export type ConversationView = {
  id: string;
  contactName: string;
  contactId: string;
  channelId: string;
  channel: ChannelType;
  subject: string | null;
  status: ConversationStatus;
  priority: Priority;
  assigneeName: string | null;
  labels: string[];
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
  slaDueAt: string | null;
};

export type MessageView = {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  senderType: "contact" | "agent" | "bot";
  senderName: string;
  text: string;
  attachments: { url: string; mime: string; name?: string }[];
  createdAt: string;
};

export type ContactView = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  lifecycleStage: string;
  attributes: Record<string, unknown>;
  conversationCount: number;
  createdAt: string;
};

export type ApprovalView = {
  id: string;
  conversationId: string;
  channelId: string;
  recipient: string;
  aiActionId: string | null;
  proposalText: string;
  editedText: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  channel: ChannelType;
  model: string | null;
  citations: { title: string; url?: string }[];
  expiresAt: string;
  createdAt: string;
};

export type ChannelView = {
  type: ChannelType;
  label: string;
  description: string;
  enabled: boolean;
  webhookUrl: string | null;
  fields: (ChannelField & { value: string })[];
};

export type StatsView = {
  open: number;
  pending: number;
  resolved: number;
  messagesToday: number;
  pendingApprovals: number;
  avgFirstResponseMin: number | null;
};

export type ApiError = { error: { code: string; message: string; details?: unknown } };

// ---------------------------------------------------------------------------
// SSE: eventos en caliente para el dashboard y el widget
// ---------------------------------------------------------------------------

export const SSE_EVENTS = {
  MESSAGE_CREATED: "message.created",
  CONVERSATION_UPDATED: "conversation.updated",
  APPROVAL_CREATED: "approval.created",
  APPROVAL_DECIDED: "approval.decided",
} as const;

export type SSEEventName = (typeof SSE_EVENTS)[keyof typeof SSE_EVENTS];

// ---------------------------------------------------------------------------
// Utilidades de respuesta
// ---------------------------------------------------------------------------

export function ok<T>(data: T) {
  return { data };
}

export function fail(code: string, message: string, status = 400, details?: unknown) {
  return { error: { code, message, details }, status };
}
