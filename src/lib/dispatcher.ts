import { createHmac } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { SSE_EVENTS } from "@/lib/contracts";
import {
  approvals,
  auditLogs,
  channels,
  conversations,
  events,
  outboundMessages,
  webhookDeliveries,
} from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { publishEvent } from "@/lib/events";
import {
  getChannelConfig,
  listDueOutbound,
  markOutbound,
  recordAudit,
} from "@/lib/repository";
import { sendViaChannel, type OutboundAttachment } from "@/lib/channels";
import { asRecord, field, getWorkspaceId, text } from "@/lib/channels/support";
import type { Row } from "@/lib/channels/support";

export type TickResult = {
  sent: number;
  failed: number;
  unknown: number;
  skipped: number;
  expired: number;
  webhooksDelivered: number;
  slaWarnings: number;
  errors: string[];
};

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Un 5xx o un fallo de socket deja el mensaje en `unknown`: no sabemos si Meta
 * lo entregó. Un 4xx o un error de configuración es permanente (`failed`).
 */
function isTransientError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message) ||
    /_API_5\d\d\b/.test(message)
  );
}

async function resolveChannelType(message: Row): Promise<string> {
  const explicit = text(field(message, "channelType", "channel", "type"));
  if (explicit) return explicit;
  const channelId = text(field(message, "channelId"));
  if (!channelId) return "";
  try {
    const [row] = await db
      .select({ type: channels.type })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    return row?.type ?? "";
  } catch {
    return "";
  }
}

function normalizeAttachments(value: unknown): OutboundAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .map((item) => asRecord(item))
    .map((item) => ({
      url: text(field(item, "url")),
      mime: text(field(item, "mime", "mimeType")),
      name: text(field(item, "name")) || undefined,
    }))
    .filter((item) => item.url.length > 0);
  return attachments.length > 0 ? attachments : undefined;
}

/** Toma un lease atómico para que dos ticks no envíen el mismo mensaje. */
async function takeLease(id: string): Promise<boolean> {
  const [leased] = await db
    .update(outboundMessages)
    .set({ status: "sending", updatedAt: new Date() })
    .where(
      and(
        eq(outboundMessages.id, id),
        inArray(outboundMessages.status, ["approved", "queued"]),
      ),
    )
    .returning({ id: outboundMessages.id });
  return Boolean(leased);
}

export async function sendDueMessages(limit = 20): Promise<Omit<TickResult, "errors">> {
  const counters = { sent: 0, failed: 0, unknown: 0, skipped: 0, expired: 0, webhooksDelivered: 0, slaWarnings: 0 };
  let due: Row[];
  try {
    due = (await listDueOutbound(limit)).map((item) => asRecord(item));
  } catch (error) {
    publishEvent("dispatcher.failed", { stage: "listDueOutbound", error: errorMessage(error) });
    return counters;
  }

  for (const message of due) {
    const id = text(field(message, "id"));
    if (!id || !(await takeLease(id))) {
      counters.skipped += 1;
      continue;
    }

    const conversationId = text(field(message, "conversationId"));
    try {
      const channelType = await resolveChannelType(message);
      if (!channelType) throw new Error("CHANNEL_TYPE_MISSING");
      const channel = await getChannelConfig(channelType);
      if (!channel) throw new Error(`CHANNEL_NOT_CONFIGURED:${channelType}`);

      const recipient = text(field(message, "recipient"));
      if (!recipient) throw new Error("RECIPIENT_MISSING");
      const body = text(field(message, "body"));

      const result = await sendViaChannel(
        channelType,
        channel.config,
        recipient,
        body,
        normalizeAttachments(field(message, "attachments")),
      );
      await markOutbound(id, "sent", {
        externalMessageId: result.externalId,
        sentAt: new Date(),
      });
      publishEvent(SSE_EVENTS.CONVERSATION_UPDATED, {
        conversationId,
        messageId: id,
        externalMessageId: result.externalId,
      });
      await recordAudit("dispatcher", "send", id, {
        channel: channelType,
        externalMessageId: result.externalId,
      });
      counters.sent += 1;
    } catch (error) {
      const messageText = errorMessage(error);
      const status = isTransientError(error) ? "unknown" : "failed";
      try {
        await markOutbound(id, status, { error: messageText });
        if (status === "failed") {
          await recordAudit("dispatcher", "send_failed", id, {
            channel: text(field(message, "channelType")),
            error: messageText,
          });
        }
      } catch (markError) {
        publishEvent("dispatcher.failed", {
          stage: "markOutbound",
          id,
          error: errorMessage(markError),
        });
      }
      if (status === "unknown") counters.unknown += 1;
      else counters.failed += 1;
    }
  }
  return counters;
}

export async function expireStaleApprovals(): Promise<number> {
  const now = new Date();
  const rows = await db
    .update(approvals)
    .set({ status: "expired", decidedAt: now, updatedAt: now })
    .where(and(eq(approvals.status, "pending"), lte(approvals.expiresAt, now)))
    .returning({ id: approvals.id, conversationId: approvals.conversationId });

  for (const row of rows) {
    publishEvent(SSE_EVENTS.APPROVAL_DECIDED, {
      approvalId: row.id,
      conversationId: row.conversationId,
      status: "expired",
    });
  }
  return rows.length;
}

/** Reintentos con backoff exponencial simple, máximo 5 intentos. */
export async function deliverOutboundWebhooks(limit = 10): Promise<number> {
  if (!env.OUTBOUND_WEBHOOK_URL) return 0;
  const now = new Date();
  const workspaceId = await getWorkspaceId();

  const due = await db
    .select({ delivery: webhookDeliveries, event: events })
    .from(webhookDeliveries)
    .leftJoin(events, eq(webhookDeliveries.eventId, events.id))
    .where(
      and(
        eq(webhookDeliveries.workspaceId, workspaceId),
        inArray(webhookDeliveries.status, ["pending", "failed"]),
        or(isNull(webhookDeliveries.nextAttemptAt), lte(webhookDeliveries.nextAttemptAt, now)),
        lte(webhookDeliveries.attempts, 4),
      ),
    )
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(limit);

  let delivered = 0;
  for (const { delivery, event } of due) {
    const previousAttempts = delivery.attempts;
    const [leased] = await db
      .update(webhookDeliveries)
      .set({ status: "delivering", attempts: previousAttempts + 1, updatedAt: new Date() })
      .where(
        and(
          eq(webhookDeliveries.id, delivery.id),
          inArray(webhookDeliveries.status, ["pending", "failed"]),
          eq(webhookDeliveries.attempts, previousAttempts),
        ),
      )
      .returning({ attempts: webhookDeliveries.attempts });
    if (!leased) continue;

    try {
      const body = JSON.stringify({
        id: delivery.id,
        event: event?.type ?? "unknown",
        data: event?.payload ?? {},
        attempt: leased.attempts,
        sentAt: new Date().toISOString(),
      });
      const signature = createHmac("sha256", env.OUTBOUND_WEBHOOK_SECRET)
        .update(body)
        .digest("hex");
      const response = await fetch(env.OUTBOUND_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nexo-signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`WEBHOOK_DELIVERY_${response.status}`);

      await db
        .update(webhookDeliveries)
        .set({ status: "delivered", responseCode: response.status, updatedAt: new Date() })
        .where(eq(webhookDeliveries.id, delivery.id));
      delivered += 1;
    } catch (error) {
      const messageText = errorMessage(error);
      const permanent =
        leased.attempts >= 5 || /WEBHOOK_DELIVERY_4\d\d/.test(messageText);
      await db
        .update(webhookDeliveries)
        .set({
          status: permanent ? "failed" : "pending",
          attempts: leased.attempts,
          lastError: messageText,
          nextAttemptAt: new Date(Date.now() + 2 ** previousAttempts * 1000),
          updatedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, delivery.id));
    }
  }
  return delivered;
}

/**
 * No hay columna `slaWarnedAt` en el esquema, así que usamos audit_log como
 * marcador: un aviso por conversación y día, sin estado en memoria.
 */
export async function notifySlaWarnings(): Promise<number> {
  const now = new Date();
  const soon = new Date(now.getTime() + 15 * 60_000);
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const workspaceId = await getWorkspaceId();

  const due = await db
    .select({ id: conversations.id, slaDueAt: conversations.slaDueAt })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        gte(conversations.slaDueAt, now),
        lte(conversations.slaDueAt, soon),
        inArray(conversations.status, ["open", "pending"]),
      ),
    );

  const alreadyWarned = await db
    .select({ resourceId: auditLogs.resourceId })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.workspaceId, workspaceId),
        eq(auditLogs.actor, "dispatcher"),
        eq(auditLogs.action, "sla_warning"),
        gte(auditLogs.createdAt, startOfDay),
      ),
    );
  const warned = new Set(alreadyWarned.map((row) => row.resourceId));

  let count = 0;
  for (const conversation of due) {
    if (warned.has(conversation.id)) continue;
    await recordAudit("dispatcher", "sla_warning", conversation.id, {
      slaDueAt: conversation.slaDueAt?.toISOString() ?? null,
    });
    publishEvent("sla.warning", {
      conversationId: conversation.id,
      slaDueAt: conversation.slaDueAt?.toISOString() ?? null,
    });
    count += 1;
  }
  return count;
}

/**
 * Idempotente por diseño: los leases atómicos y el audit de SLA evitan
 * duplicados aunque Vercel llame dos veces al cron.
 */
export async function runTick(): Promise<TickResult> {
  const result: TickResult = {
    sent: 0,
    failed: 0,
    unknown: 0,
    skipped: 0,
    expired: 0,
    webhooksDelivered: 0,
    slaWarnings: 0,
    errors: [],
  };

  const steps: { name: string; run: () => Promise<void> }[] = [
    {
      name: "sendDueMessages",
      run: async () => {
        const counters = await sendDueMessages();
        result.sent = counters.sent;
        result.failed = counters.failed;
        result.unknown = counters.unknown;
        result.skipped = counters.skipped;
      },
    },
    {
      name: "expireStaleApprovals",
      run: async () => {
        result.expired = await expireStaleApprovals();
      },
    },
    {
      name: "deliverOutboundWebhooks",
      run: async () => {
        result.webhooksDelivered = await deliverOutboundWebhooks();
      },
    },
    {
      name: "notifySlaWarnings",
      run: async () => {
        result.slaWarnings = await notifySlaWarnings();
      },
    },
  ];

  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      result.errors.push(`${step.name}: ${errorMessage(error)}`);
    }
  }
  return result;
}
