import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  CanonicalMessageSchema,
  SSE_EVENTS,
  type CanonicalMessage,
} from "@/lib/contracts";
import { aiActions, approvals, outboundMessages } from "@/db/schema";
import { approverChatIds, env } from "@/lib/env";
import { db } from "@/lib/db";
import { safeEqual } from "@/lib/crypto";
import { publishEvent } from "@/lib/events";
import {
  createOutboundMessage,
  decideApproval,
  getApproval,
  getChannelConfig,
  recordAudit,
} from "@/lib/repository";
import type { InboundAdapter, OutboundAdapter } from "./types";
import {
  asDate,
  asRecord,
  decodeCallbackData,
  encodeCallbackData,
  field,
  hashCallbackToken,
  integer,
  readJsonBody,
  readRawBody,
  text,
} from "./support";
import type { Row } from "./support";

const API_BASE = "https://api.telegram.org/bot";
const EDIT_TTL_MS = 5 * 60_000;

async function callBot(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<Row> {
  const response = await fetch(`${API_BASE}${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`TELEGRAM_API_${response.status}`);
  return asRecord(json);
}

async function telegramConfig(): Promise<Record<string, unknown>> {
  try {
    return (await getChannelConfig("telegram"))?.config ?? {};
  } catch {
    return {};
  }
}

/** La whitelist puede venir de env o del canal guardado en la BD. */
async function allowedApprovers(config: Record<string, unknown>): Promise<Set<string>> {
  const ids = new Set<string>(approverChatIds);
  const configured = config.approverChatIds;
  const values = Array.isArray(configured)
    ? configured
    : text(configured).split(",").map((item) => item.trim());
  values.map((value) => text(value).trim()).filter(Boolean).forEach((id) => ids.add(id));
  return ids;
}

/**
 * `getApproval` devuelve una vista sin el hash: lo leemos directamente para
 * validar el token del callback sin exponerlo a la UI.
 */
async function readTokenHash(approvalId: string): Promise<string> {
  try {
    const [row] = await db
      .select({ hash: approvals.callbackTokenHash })
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .limit(1);
    return row?.hash ?? "";
  } catch {
    return "";
  }
}

export const telegramInbound: InboundAdapter = {
  async verify(request, config) {
    // Guardamos el body crudo: los routes de Next suelen leerlo antes que el adapter.
    await readRawBody(request).catch(() => "");
    const expected = text(config.verifyToken) || env.TELEGRAM_WEBHOOK_SECRET;
    const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!expected || !provided) return false;
    try {
      return safeEqual(provided, expected);
    } catch {
      return false;
    }
  },

  async parse(request): Promise<CanonicalMessage[]> {
    const payload = asRecord(await readJsonBody(request));
    const message = asRecord(payload.message);
    if (Object.keys(message).length === 0) return [];

    const from = asRecord(message.from);
    const chat = asRecord(message.chat);
    const messageId = text(field(message, "message_id"));
    const chatId = text(field(chat, "id"));
    const senderId = text(field(from, "id")) || chatId;
    const unixDate = integer(field(message, "date"));
    const occurredAt = unixDate > 0 ? new Date(unixDate * 1000).toISOString() : undefined;
    const body = text(field(message, "text")) || text(field(message, "caption"));

    return [
      CanonicalMessageSchema.parse({
        externalId: `telegram:${chatId}:${messageId}`,
        channel: "telegram",
        direction: "inbound",
        contact: {
          externalId: senderId,
          displayName:
            [text(field(from, "first_name")), text(field(from, "last_name"))]
              .filter(Boolean)
              .join(" ") || text(field(from, "username")),
        },
        conversationExternalId: chatId,
        text: body,
        metadata: {
          source: "telegram",
          chatId,
          messageId,
          username: text(field(from, "username")),
          updateId: text(field(payload, "update_id")),
        },
        ...(occurredAt ? { occurredAt } : {}),
      }),
    ];
  },
};

export const telegramOutbound: OutboundAdapter = {
  async send(config, recipient, body) {
    const botToken = text(config.botToken) || env.TELEGRAM_BOT_TOKEN;
    if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
    const response = await callBot(botToken, "sendMessage", {
      chat_id: recipient,
      text: body,
    });
    return { externalId: text(field(response, "message_id")) || randomUUID() };
  },
};

/**
 * Avisa a cada aprobador con botones Aprobar/Editar/Rechazar. El token viaja
 * en callback_data; en la BD solo guardamos su hash.
 */
export async function notifyTelegramApproval(
  approvalId: string,
  conversationId: string,
  proposalText: string,
  citations: string[],
  callbackToken: string = randomUUID(),
): Promise<void> {
  const config = await telegramConfig();
  const botToken = text(config.botToken) || env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  const approvers = await allowedApprovers(config);
  if (approvers.size === 0) return;

  const buttons = [
    { text: "Aprobar", callback_data: encodeCallbackData({ approvalId, action: "approve", token: callbackToken }) },
    { text: "Editar", callback_data: encodeCallbackData({ approvalId, action: "edit", token: callbackToken }) },
    { text: "Rechazar", callback_data: encodeCallbackData({ approvalId, action: "reject", token: callbackToken }) },
  ];
  const lines = [
    "Nueva propuesta de respuesta (aún no enviada)",
    `Conversación: ${conversationId}`,
    "",
    proposalText,
  ];
  if (citations.length > 0) lines.push("", `Fuentes: ${citations.join(" · ")}`);

  await Promise.allSettled(
    [...approvers].map((chatId) =>
      callBot(botToken, "sendMessage", {
        chat_id: chatId,
        text: lines.join("\n"),
        reply_markup: { inline_keyboard: [buttons] },
      }),
    ),
  );
}

/**
 * Mapa en memoria para el botón "Editar". LIMITACIÓN: en serverless con
 * varios procesos un mensaje puede caer en otra instancia y no encontrar la
 * entrada. La edición definitiva y auditable se hace en la UI (/approvals).
 */
const pendingEdits = new Map<
  string,
  { approvalId: string; token: string; expiresAt: number }
>();

/** Idempotencia: un mismo approval nunca genera dos mensajes salientes. */
async function createOutboundForApproval(
  approval: Row,
  finalText: string,
  approverChatId: string,
): Promise<boolean> {
  const approvalId = text(field(approval, "id"));
  const aiActionId = text(field(approval, "aiActionId")) || undefined;

  if (aiActionId) {
    const [action] = await db
      .select({ outboundMessageId: aiActions.outboundMessageId })
      .from(aiActions)
      .where(eq(aiActions.id, aiActionId))
      .limit(1);
    if (action?.outboundMessageId) return false;
  }

  const outboundId = await createOutboundMessage({
    conversationId: text(field(approval, "conversationId")),
    channelId: text(field(approval, "channelId")),
    recipient: text(field(approval, "recipient")),
    body: finalText,
    authorType: "ai",
    status: "queued",
    ...(aiActionId ? { aiActionId } : {}),
  });

  // Clave estable para futuros reintentos del propio callback de Telegram.
  try {
    await db
      .update(outboundMessages)
      .set({ idempotencyKey: `approval:${approvalId}` })
      .where(eq(outboundMessages.id, outboundId));
  } catch {
    // Ya se creó: no fallamos la aprobación por no poder fijar la clave.
  }

  publishEvent(SSE_EVENTS.CONVERSATION_UPDATED, {
    conversationId: text(field(approval, "conversationId")),
    messageId: outboundId,
    source: "telegram-approval",
  });
  await recordAudit("telegram", "approve", approvalId, { chatId: approverChatId });
  return true;
}

function isExpired(approval: Row): boolean {
  const expiresAt = asDate(field(approval, "expiresAt"));
  return !expiresAt || expiresAt.getTime() <= Date.now();
}

/** Callback de los botones del mensaje de aprobación. */
export async function handleTelegramCallback(callbackQuery: Record<string, unknown>): Promise<void> {
  const callbackId = text(field(callbackQuery, "id"));
  const from = asRecord(field(callbackQuery, "from"));
  const message = asRecord(field(callbackQuery, "message"));
  const chat = asRecord(field(message, "chat"));
  const chatId = text(field(chat, "id")) || text(field(from, "id"));
  const data = decodeCallbackData(text(field(callbackQuery, "data")));
  const config = await telegramConfig();

  const answer = async (answerText: string): Promise<void> => {
    try {
      const botToken = text(config.botToken) || env.TELEGRAM_BOT_TOKEN;
      if (botToken) await callBot(botToken, "answerCallbackQuery", { callback_query_id: callbackId, text: answerText });
    } catch {
      // Telegram reintenta el callback; nunca debemos romper el webhook por esto.
    }
  };

  if (!data) {
    await answer("Enlace inválido.");
    return;
  }
  if (!(await allowedApprovers(config)).has(chatId)) {
    await answer("No tienes permiso para aprobar.");
    return;
  }

  let approval: Row;
  try {
    approval = asRecord(await getApproval(data.approvalId));
  } catch {
    await answer("No se pudo leer la propuesta.");
    return;
  }
  if (!approval || Object.keys(approval).length === 0) {
    await answer("La propuesta ya no existe.");
    return;
  }
  if (text(field(approval, "status")) !== "pending") {
    await answer("Esta propuesta ya fue decidida.");
    return;
  }
  if (isExpired(approval)) {
    await answer("La propuesta expiró. Genera una nueva.");
    return;
  }

  const storedHash = await readTokenHash(data.approvalId);
  let tokenValid = false;
  try {
    tokenValid = Boolean(storedHash) && safeEqual(hashCallbackToken(data.token), storedHash);
  } catch {
    tokenValid = false;
  }
  if (!tokenValid) {
    await answer("Token inválido.");
    return;
  }

  const finalText =
    text(field(approval, "editedText")) ||
    text(field(approval, "proposalText", "proposedText"));

  if (data.action === "reject") {
    // No pasamos approverAgentId: es FK a agent y el chat_id de Telegram no lo es.
    await decideApproval(data.approvalId, { status: "rejected" });
    await recordAudit("telegram", "reject", data.approvalId, { chatId });
    publishEvent(SSE_EVENTS.APPROVAL_DECIDED, {
      approvalId: data.approvalId,
      conversationId: text(field(approval, "conversationId")),
      status: "rejected",
    });
    await answer("Rechazado.");
    return;
  }

  if (data.action === "edit") {
    pendingEdits.set(chatId, {
      approvalId: data.approvalId,
      token: data.token,
      expiresAt: Date.now() + EDIT_TTL_MS,
    });
    try {
      const botToken = text(config.botToken) || env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        await callBot(botToken, "sendMessage", {
          chat_id: chatId,
          text: "Escribe el texto final que quieres enviar. Usa la UI (/approvals) para una edición auditable.",
        });
      }
    } catch {
      // El aviso es best-effort; la UI sigue disponible.
    }
    await answer("Escribe el texto final.");
    return;
  }

  await decideApproval(data.approvalId, { status: "approved" });
  await createOutboundForApproval(approval, finalText, chatId);
  publishEvent(SSE_EVENTS.APPROVAL_DECIDED, {
    approvalId: data.approvalId,
    conversationId: text(field(approval, "conversationId")),
    status: "approved",
  });
  await answer("Aprobado. Quedó en cola de envío.");
}

/**
 * Procesa el mensaje posterior al botón "Editar". Devuelve true cuando el
 * mensaje se consumió como una edición; false cuando es un mensaje normal.
 */
export async function handleTelegramText(message: Record<string, unknown>): Promise<boolean> {
  const chat = asRecord(field(message, "chat"));
  const chatId = text(field(chat, "id"));
  const pending = pendingEdits.get(chatId);
  if (!pending) return false;
  pendingEdits.delete(chatId);
  if (pending.expiresAt <= Date.now()) return false;

  const body = text(field(message, "text")).trim();
  if (!body) return true;

  let approval: Row;
  try {
    approval = asRecord(await getApproval(pending.approvalId));
  } catch {
    return true;
  }
  if (text(field(approval, "status")) !== "pending" || isExpired(approval)) return true;
  const storedHash = await readTokenHash(pending.approvalId);
  let tokenValid = false;
  try {
    tokenValid = Boolean(storedHash) && safeEqual(hashCallbackToken(pending.token), storedHash);
  } catch {
    tokenValid = false;
  }
  if (!tokenValid) return true;

  await decideApproval(pending.approvalId, { status: "approved", editedText: body });
  await createOutboundForApproval({ ...approval, editedText: body }, body, chatId);
  publishEvent(SSE_EVENTS.APPROVAL_DECIDED, {
    approvalId: pending.approvalId,
    conversationId: text(field(approval, "conversationId")),
    status: "approved",
    edited: true,
  });
  return true;
}
