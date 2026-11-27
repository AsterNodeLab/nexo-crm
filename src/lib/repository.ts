/**
 * Capa de datos de Nexo. Toda la API y los adapters pasan por aquí:
 * la interfaz nunca ve filas crudas de Drizzle, solo los tipos de `contracts.ts`.
 */
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  CHANNEL_META,
  CHANNEL_TYPES,
  CanonicalMessageSchema,
  ChannelTypeSchema,
  SSE_EVENTS,
  type ApprovalView,
  type CanonicalMessage,
  type ChannelType,
  type ChannelView,
  type ContactView,
  type ConversationStatus,
  type ConversationView,
  type MessageView,
  type Priority,
  type StatsView,
} from "@/lib/contracts";
import type { Channel, Contact, Conversation } from "@/db/schema";
import {
  agents,
  aiActions,
  approvals,
  auditLogs,
  channels,
  contacts,
  conversationLabels,
  conversations,
  labels,
  messages,
  outboundMessages,
  workspaces,
} from "@/db/schema";
import { decryptConfig, encryptConfig, isMaskedSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events";

// ---------------------------------------------------------------------------
// Validaciones y conversiones (nunca `any`)
// ---------------------------------------------------------------------------

const STATUS_VALUES = ["open", "pending", "resolved"] as const;
const PRIORITY_VALUES = ["low", "normal", "high", "urgent"] as const;
const APPROVAL_STATUS_VALUES = ["pending", "approved", "rejected", "expired"] as const;
const SENDER_TYPE_VALUES = ["contact", "agent", "bot"] as const;

const AttachmentListSchema = z.array(z.object({ url: z.string(), mime: z.string(), name: z.string().optional() }));
const CitationListSchema = z.array(z.object({ title: z.string(), url: z.string().optional() }));
const RecordSchema = z.record(z.string(), z.unknown());

function asStatus(value: string): ConversationStatus {
  return STATUS_VALUES.includes(value as ConversationStatus) ? (value as ConversationStatus) : "open";
}

function asPriority(value: string): Priority {
  return PRIORITY_VALUES.includes(value as Priority) ? (value as Priority) : "normal";
}

function asApprovalStatus(value: string): ApprovalView["status"] {
  return APPROVAL_STATUS_VALUES.includes(value as ApprovalView["status"])
    ? (value as ApprovalView["status"])
    : "pending";
}

function asSenderType(value: string): MessageView["senderType"] {
  return SENDER_TYPE_VALUES.includes(value as MessageView["senderType"])
    ? (value as MessageView["senderType"])
    : "contact";
}

function asChannelType(value: string): ChannelType {
  const parsed = ChannelTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "web";
}

function parseAttachments(value: unknown): MessageView["attachments"] {
  const parsed = AttachmentListSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function parseCitations(value: unknown): ApprovalView["citations"] {
  const parsed = CitationListSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function parseRecord(value: unknown): Record<string, unknown> {
  const parsed = RecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function clampLimit(value: number | undefined, fallback: number, max = 200): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), max));
}

/** El seed crea un único workspace; todas las consultas se aíslan con él. */
async function getWorkspaceId(): Promise<string> {
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).orderBy(asc(workspaces.createdAt)).limit(1);
  if (!ws) throw new Error("No existe un workspace configurado. Ejecuta el seed primero.");
  return ws.id;
}

// ---------------------------------------------------------------------------
// Conversaciones
// ---------------------------------------------------------------------------

const conversationSelection = {
  conversation: conversations,
  contactName: contacts.displayName,
  channelType: channels.type,
  assigneeName: agents.displayName,
};

type ConversationRow = {
  conversation: Conversation;
  contactName: string;
  channelType: string;
  assigneeName: string | null;
};

async function labelsForConversationIds(ids: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (ids.length === 0) return result;
  const rows = await db
    .select({ conversationId: conversationLabels.conversationId, name: labels.name })
    .from(conversationLabels)
    .innerJoin(labels, eq(conversationLabels.labelId, labels.id))
    .where(inArray(conversationLabels.conversationId, ids))
    .orderBy(asc(labels.name));
  for (const row of rows) {
    const current = result.get(row.conversationId) ?? [];
    current.push(row.name);
    result.set(row.conversationId, current);
  }
  return result;
}

function toConversationView(row: ConversationRow, labelNames: string[]): ConversationView {
  return {
    id: row.conversation.id,
    contactName: row.contactName,
    contactId: row.conversation.contactId,
    channelId: row.conversation.channelId,
    channel: asChannelType(row.channelType),
    subject: row.conversation.subject,
    status: asStatus(row.conversation.status),
    priority: asPriority(row.conversation.priority),
    assigneeName: row.assigneeName,
    labels: labelNames,
    lastMessage: row.conversation.lastMessage ?? "",
    lastMessageAt: row.conversation.lastMessageAt.toISOString(),
    unread: row.conversation.unread,
    slaDueAt: row.conversation.slaDueAt?.toISOString() ?? null,
  };
}

export async function listConversations(filter?: {
  status?: string;
  channel?: string;
  limit?: number;
}): Promise<ConversationView[]> {
  const conditions: SQL[] = [];
  if (filter?.status) conditions.push(eq(conversations.status, filter.status));
  if (filter?.channel) conditions.push(eq(channels.type, filter.channel));

  const rows = await db
    .select(conversationSelection)
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .innerJoin(channels, eq(conversations.channelId, channels.id))
    .leftJoin(agents, eq(conversations.assigneeAgentId, agents.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(clampLimit(filter?.limit, 50));

  const labelsByConversation = await labelsForConversationIds(rows.map((row) => row.conversation.id));
  return rows.map((row) => toConversationView(row, labelsByConversation.get(row.conversation.id) ?? []));
}

export async function getConversation(id: string): Promise<(ConversationView & { contactName: string }) | null> {
  const [row] = await db
    .select(conversationSelection)
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .innerJoin(channels, eq(conversations.channelId, channels.id))
    .leftJoin(agents, eq(conversations.assigneeAgentId, agents.id))
    .where(eq(conversations.id, id))
    .limit(1);
  if (!row) return null;
  const labelMap = await labelsForConversationIds([id]);
  const view = toConversationView(row, labelMap.get(id) ?? []);
  return { ...view, contactName: row.contactName };
}

export async function getConversationMessages(id: string): Promise<MessageView[]> {
  const rows = await db
    .select({ message: messages, agentName: agents.displayName })
    .from(messages)
    .leftJoin(agents, eq(messages.senderAgentId, agents.id))
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  return rows.map(({ message, agentName }) => {
    const senderType = asSenderType(message.senderType);
    const fallback = senderType === "bot" ? "Nexo AI" : senderType === "agent" ? "Agente" : "Contacto";
    return {
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction === "outbound" ? "outbound" : "inbound",
      senderType,
      senderName: message.senderName ?? agentName ?? fallback,
      text: message.bodyText ?? "",
      attachments: parseAttachments(message.attachments),
      createdAt: (message.occurredAt ?? message.createdAt).toISOString(),
    };
  });
}

async function replaceConversationLabels(conversationId: string, names: string[]): Promise<void> {
  const workspaceId = await getWorkspaceId();
  await db.delete(conversationLabels).where(eq(conversationLabels.conversationId, conversationId));
  const uniqueNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  for (const name of uniqueNames) {
    const [existing] = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.workspaceId, workspaceId), eq(labels.name, name)))
      .limit(1);
    let labelId = existing?.id;
    if (!labelId) {
      const [created] = await db.insert(labels).values({ workspaceId, name }).returning({ id: labels.id });
      labelId = created.id;
    }
    await db
      .insert(conversationLabels)
      .values({ conversationId, labelId })
      .onConflictDoNothing();
  }
}

export async function updateConversation(
  id: string,
  patch: {
    status?: string;
    priority?: string;
    assigneeAgentId?: string | null;
    labels?: string[];
  },
): Promise<void> {
  const set: Partial<typeof conversations.$inferInsert> = { updatedAt: new Date() };
  if (patch.status !== undefined) {
    set.status = patch.status;
    set.resolvedAt = patch.status === "resolved" ? new Date() : null;
  }
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.assigneeAgentId !== undefined) set.assigneeAgentId = patch.assigneeAgentId;
  await db.update(conversations).set(set).where(eq(conversations.id, id));
  if (patch.labels !== undefined) await replaceConversationLabels(id, patch.labels);
  publishEvent(SSE_EVENTS.CONVERSATION_UPDATED, { id, patch });
}

// ---------------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------------

function toContactView(contact: Contact, conversationCount: number): ContactView {
  return {
    id: contact.id,
    displayName: contact.displayName,
    email: contact.email,
    phone: contact.phone,
    lifecycleStage: contact.lifecycleStage,
    attributes: parseRecord(contact.attributes),
    conversationCount,
    createdAt: contact.createdAt.toISOString(),
  };
}

const conversationCounts = db
  .select({ contactId: conversations.contactId, total: count() })
  .from(conversations)
  .groupBy(conversations.contactId)
  .as("conversation_counts");

export async function listContacts(limit = 50): Promise<ContactView[]> {
  const rows = await db
    .select({ contact: contacts, total: conversationCounts.total })
    .from(contacts)
    .leftJoin(conversationCounts, eq(contacts.id, conversationCounts.contactId))
    .orderBy(desc(contacts.createdAt))
    .limit(clampLimit(limit, 50));
  return rows.map(({ contact, total }) => toContactView(contact, total ?? 0));
}

export async function getContact(id: string): Promise<ContactView | null> {
  const [row] = await db
    .select({ contact: contacts, total: conversationCounts.total })
    .from(contacts)
    .leftJoin(conversationCounts, eq(contacts.id, conversationCounts.contactId))
    .where(eq(contacts.id, id))
    .limit(1);
  return row ? toContactView(row.contact, row.total ?? 0) : null;
}

export async function updateContact(
  id: string,
  patch: Partial<{
    displayName: string;
    email: string;
    phone: string;
    lifecycleStage: string;
    attributes: Record<string, unknown>;
  }>,
): Promise<void> {
  const set: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.email !== undefined) set.email = patch.email;
  if (patch.phone !== undefined) set.phone = patch.phone;
  if (patch.lifecycleStage !== undefined) set.lifecycleStage = patch.lifecycleStage;
  if (patch.attributes !== undefined) {
    // Fusionamos para que actualizar un atributo no borre los demás.
    const [current] = await db.select({ attributes: contacts.attributes }).from(contacts).where(eq(contacts.id, id)).limit(1);
    set.attributes = { ...parseRecord(current?.attributes), ...patch.attributes };
  }
  await db.update(contacts).set(set).where(eq(contacts.id, id));
}

// ---------------------------------------------------------------------------
// Aprobaciones
// ---------------------------------------------------------------------------

const approvalSelection = {
  approval: approvals,
  conversationChannelId: conversations.channelId,
  channelType: channels.type,
  model: aiActions.model,
  citations: aiActions.citations,
};

type ApprovalRow = {
  approval: typeof approvals.$inferSelect;
  conversationChannelId: string;
  channelType: string;
  model: string | null;
  citations: unknown;
};

function toApprovalView(row: ApprovalRow): ApprovalView {
  return {
    id: row.approval.id,
    conversationId: row.approval.conversationId,
    channelId: row.approval.channelId ?? row.conversationChannelId,
    recipient: row.approval.recipient,
    aiActionId: row.approval.aiActionId ?? null,
    proposalText: row.approval.proposedText,
    editedText: row.approval.editedText,
    status: asApprovalStatus(row.approval.status),
    channel: asChannelType(row.channelType),
    model: row.model ?? null,
    citations: parseCitations(row.citations),
    expiresAt: row.approval.expiresAt.toISOString(),
    createdAt: row.approval.createdAt.toISOString(),
  };
}

function approvalQuery() {
  return db
    .select(approvalSelection)
    .from(approvals)
    .innerJoin(conversations, eq(approvals.conversationId, conversations.id))
    .innerJoin(channels, eq(conversations.channelId, channels.id))
    .leftJoin(aiActions, eq(approvals.aiActionId, aiActions.id));
}

export async function listApprovals(status?: string): Promise<ApprovalView[]> {
  const rows = await approvalQuery()
    .where(status ? eq(approvals.status, status) : undefined)
    .orderBy(desc(approvals.createdAt));
  return rows.map(toApprovalView);
}

export async function getApproval(id: string): Promise<ApprovalView | null> {
  const [row] = await approvalQuery().where(eq(approvals.id, id)).limit(1);
  return row ? toApprovalView(row) : null;
}

export async function createApproval(input: {
  actionType: string;
  resourceId: string;
  proposedText: string;
  expiresAt: Date;
  callbackTokenHash: string;
  channelId?: string;
  recipient?: string;
  aiActionId?: string | null;
}): Promise<string> {
  const workspaceId = await getWorkspaceId();

  // `resourceId` puede ser la conversación o la acción de IA: resolvemos ambos casos.
  let conversationId = input.resourceId;
  let aiActionId: string | null = input.aiActionId ?? null;
  let channelId: string | null = input.channelId ?? null;
  let recipient = input.recipient ?? "";

  const [directConversation] = await db
    .select({ id: conversations.id, channelId: conversations.channelId })
    .from(conversations)
    .where(eq(conversations.id, input.resourceId))
    .limit(1);
  if (directConversation) {
    conversationId = directConversation.id;
    channelId ??= directConversation.channelId;
  } else {
    const candidateActionId = aiActionId ?? input.resourceId;
    const [action] = candidateActionId
      ? await db
          .select({ id: aiActions.id, conversationId: aiActions.conversationId })
          .from(aiActions)
          .where(eq(aiActions.id, candidateActionId))
          .limit(1)
      : [];
    if (action) {
      aiActionId = action.id;
      conversationId = action.conversationId;
      const [conv] = await db
        .select({ channelId: conversations.channelId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      channelId ??= conv?.channelId ?? null;
    }
  }

  if (!recipient) {
    const [contact] = await db
      .select({ email: contacts.email, phone: contacts.phone, externalId: contacts.externalId })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(eq(conversations.id, conversationId))
      .limit(1);
    recipient = contact?.email ?? contact?.phone ?? contact?.externalId ?? "";
  }

  const [created] = await db
    .insert(approvals)
    .values({
      workspaceId,
      conversationId,
      channelId,
      recipient,
      aiActionId,
      actionType: input.actionType,
      resourceId: input.resourceId,
      proposedText: input.proposedText,
      status: "pending",
      callbackTokenHash: input.callbackTokenHash,
      expiresAt: input.expiresAt,
    })
    .returning({ id: approvals.id });

  if (aiActionId) {
    await db.update(aiActions).set({ approvalId: created.id }).where(eq(aiActions.id, aiActionId));
  }
  publishEvent(SSE_EVENTS.APPROVAL_CREATED, {
    id: created.id,
    conversationId,
    channelId,
    recipient,
    actionType: input.actionType,
  });
  return created.id;
}

export async function decideApproval(
  id: string,
  decision: {
    status: "approved" | "rejected" | "expired";
    approverAgentId?: string;
    editedText?: string;
  },
): Promise<void> {
  await db
    .update(approvals)
    .set({
      status: decision.status,
      approverAgentId: decision.approverAgentId ?? null,
      editedText: decision.editedText ?? null,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(approvals.id, id));
  publishEvent(SSE_EVENTS.APPROVAL_DECIDED, { id, status: decision.status });
}

// ---------------------------------------------------------------------------
// Canales
// ---------------------------------------------------------------------------

export async function listChannels(appUrl: string): Promise<ChannelView[]> {
  const rows = await db.select().from(channels);
  const byType = new Map<string, Channel>();
  for (const row of rows) byType.set(row.type, row);
  const baseUrl = appUrl.replace(/\/+$/, "");

  return CHANNEL_TYPES.map((type) => {
    const meta = CHANNEL_META[type];
    const existing = byType.get(type);
    let config: Record<string, unknown> = {};
    if (existing) {
      try {
        config = parseRecord(decryptConfig<unknown>(existing.encryptedConfig));
      } catch {
        config = {};
      }
    }
    return {
      type,
      label: meta.label,
      description: meta.description,
      enabled: existing?.enabled ?? false,
      webhookUrl: meta.webhookPath ? `${baseUrl}${meta.webhookPath}` : null,
      fields: meta.fields.map((field) => {
        const value = config[field.key];
        return {
          ...field,
          // Los secretos nunca salen de aquí: solo la máscara.
          value: field.secret && value ? "••••••" : value == null ? "" : String(value),
        };
      }),
    };
  });
}

export async function getChannelConfig(type: string): Promise<{ id: string; config: Record<string, unknown> } | null> {
  const [row] = await db.select().from(channels).where(eq(channels.type, type)).limit(1);
  if (!row) return null;
  try {
    return { id: row.id, config: parseRecord(decryptConfig<unknown>(row.encryptedConfig)) };
  } catch {
    return { id: row.id, config: {} };
  }
}

function externalIdFromConfig(config: Record<string, unknown>): string {
  for (const key of ["botToken", "phoneNumberId", "businessAccountId", "appId", "imapUser"]) {
    const value = config[key];
    if (typeof value === "string" && value) return value.slice(0, 120);
  }
  return "";
}

export async function upsertChannel(type: string, config: Record<string, unknown>): Promise<void> {
  const workspaceId = await getWorkspaceId();
  const incoming = parseRecord(config);
  const [existing] = await db.select().from(channels).where(eq(channels.type, type)).limit(1);

  if (!existing) {
    await db.insert(channels).values({
      workspaceId,
      type,
      externalIdentifier: externalIdFromConfig(incoming),
      encryptedConfig: encryptConfig(incoming),
      enabled: true,
    });
    return;
  }

  let previous: Record<string, unknown> = {};
  try {
    previous = parseRecord(decryptConfig<unknown>(existing.encryptedConfig));
  } catch {
    // Si el ciphertext está corrupto, partimos de una configuración vacía.
  }

  const merged = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    // La UI reenvía '••••••' cuando el usuario no tocó el secreto: conservamos el anterior.
    if (isMaskedSecret(value) && typeof previous[key] === "string") continue;
    merged[key] = value;
  }

  await db
    .update(channels)
    .set({
      encryptedConfig: encryptConfig(merged),
      externalIdentifier: existing.externalIdentifier || externalIdFromConfig(merged),
      updatedAt: new Date(),
    })
    .where(eq(channels.id, existing.id));
}

// ---------------------------------------------------------------------------
// Estadísticas
// ---------------------------------------------------------------------------

export async function getStats(): Promise<StatsView> {
  const workspaceId = await getWorkspaceId();
  const statusRows = await db
    .select({ status: conversations.status, total: count() })
    .from(conversations)
    .where(eq(conversations.workspaceId, workspaceId))
    .groupBy(conversations.status);
  const totals = new Map(statusRows.map((row) => [row.status, row.total]));

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const [messageRow] = await db
    .select({ total: count() })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), gte(messages.createdAt, startOfToday)));
  const [approvalRow] = await db
    .select({ total: count() })
    .from(approvals)
    .where(and(eq(approvals.workspaceId, workspaceId), eq(approvals.status, "pending")));
  const [responseRow] = await db
    .select({
      // avg() de PostgreSQL devuelve numeric, que postgres.js entrega como string.
      avg: sql<string | null>`avg(extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt})) / 60)`,
    })
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), isNotNull(conversations.firstResponseAt)));

  const rawAvg = responseRow?.avg == null ? Number.NaN : Number(responseRow.avg);
  return {
    open: totals.get("open") ?? 0,
    pending: totals.get("pending") ?? 0,
    resolved: totals.get("resolved") ?? 0,
    messagesToday: messageRow?.total ?? 0,
    pendingApprovals: approvalRow?.total ?? 0,
    avgFirstResponseMin: Number.isFinite(rawAvg) ? Math.round(rawAvg * 10) / 10 : null,
  };
}

// ---------------------------------------------------------------------------
// Ingesta de mensajes canónicos
// ---------------------------------------------------------------------------

async function resolveChannelForIngest(message: CanonicalMessage, workspaceId: string): Promise<Channel> {
  if (message.channelId) {
    const [byId] = await db.select().from(channels).where(eq(channels.id, message.channelId)).limit(1);
    if (byId) return byId;
  }
  const [existing] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.workspaceId, workspaceId), eq(channels.type, message.channel)))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(channels)
    .values({ workspaceId, type: message.channel, externalIdentifier: "", encryptedConfig: encryptConfig({}), enabled: true })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [fallback] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.workspaceId, workspaceId), eq(channels.type, message.channel)))
    .limit(1);
  if (!fallback) throw new Error("No se pudo resolver el canal del mensaje");
  return fallback;
}

async function resolveContactForIngest(message: CanonicalMessage, workspaceId: string, at: Date): Promise<Contact> {
  const condition = and(
    eq(contacts.workspaceId, workspaceId),
    eq(contacts.externalId, message.contact.externalId),
  );
  const [existing] = await db.select().from(contacts).where(condition).limit(1);
  if (existing) {
    const patch: Partial<typeof contacts.$inferInsert> = { lastSeenAt: at, updatedAt: new Date() };
    if (message.contact.displayName) patch.displayName = message.contact.displayName;
    if (message.contact.email) patch.email = message.contact.email;
    if (message.contact.phone) patch.phone = message.contact.phone;
    if (message.contact.avatarUrl) patch.avatarUrl = message.contact.avatarUrl;
    await db.update(contacts).set(patch).where(eq(contacts.id, existing.id));
    const [refreshed] = await db.select().from(contacts).where(eq(contacts.id, existing.id)).limit(1);
    if (!refreshed) throw new Error("No se pudo refrescar el contacto");
    return refreshed;
  }

  const [created] = await db
    .insert(contacts)
    .values({
      workspaceId,
      externalId: message.contact.externalId,
      displayName: message.contact.displayName ?? message.contact.externalId,
      email: message.contact.email ?? null,
      phone: message.contact.phone ?? null,
      avatarUrl: message.contact.avatarUrl ?? null,
      lastSeenAt: at,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [found] = await db.select().from(contacts).where(condition).limit(1);
  if (!found) throw new Error("No se pudo resolver el contacto del mensaje");
  return found;
}

async function resolveConversationForIngest(
  message: CanonicalMessage,
  workspaceId: string,
  contactId: string,
  channelId: string,
  at: Date,
): Promise<{ id: string; created: boolean }> {
  let existing: Conversation | undefined;
  if (message.conversationExternalId) {
    [existing] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.externalId, message.conversationExternalId)))
      .limit(1);
  }
  if (!existing) {
    // Sin ID externo reutilizamos la conversación abierta más reciente de ese contacto/canal.
    [existing] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, workspaceId),
          eq(conversations.contactId, contactId),
          eq(conversations.channelId, channelId),
          ne(conversations.status, "resolved"),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
  }
  if (existing) return { id: existing.id, created: false };

  const metadataSubject = message.metadata.subject;
  const [created] = await db
    .insert(conversations)
    .values({
      workspaceId,
      externalId: message.conversationExternalId ?? null,
      contactId,
      channelId,
      subject: typeof metadataSubject === "string" ? metadataSubject : null,
      status: "open",
      priority: "normal",
      unread: 0,
      lastMessageAt: at,
      lastMessage: message.text,
    })
    .onConflictDoNothing()
    .returning({ id: conversations.id });
  if (created) return { id: created.id, created: true };

  if (message.conversationExternalId) {
    const [found] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.externalId, message.conversationExternalId)))
      .limit(1);
    if (found) return { id: found.id, created: false };
  }
  throw new Error("No se pudo resolver la conversación del mensaje");
}

export async function ingestCanonicalMessage(
  msg: CanonicalMessage,
): Promise<{ conversationId: string; messageId: string; created: boolean }> {
  // Validación en la frontera: los webhooks son entrada del usuario.
  const message = CanonicalMessageSchema.parse(msg);
  const workspaceId = await getWorkspaceId();
  const occurredAt = message.occurredAt ? new Date(message.occurredAt) : new Date();

  const channel = await resolveChannelForIngest(message, workspaceId);
  const contact = await resolveContactForIngest(message, workspaceId, occurredAt);
  const conversation = await resolveConversationForIngest(message, workspaceId, contact.id, channel.id, occurredAt);

  const [duplicate] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.externalMessageId, message.externalId))
    .limit(1);
  if (duplicate) {
    return { conversationId: conversation.id, messageId: duplicate.id, created: false };
  }

  const senderType = message.direction === "outbound" ? "agent" : "contact";
  const [inserted] = await db
    .insert(messages)
    .values({
      workspaceId,
      conversationId: conversation.id,
      direction: message.direction,
      senderType,
      senderName: senderType === "contact" ? (message.contact.displayName ?? message.contact.externalId) : "Nexo",
      bodyText: message.text,
      attachments: message.attachments,
      externalMessageId: message.externalId,
      threadKey: message.threadKey ?? null,
      metadata: message.metadata,
      occurredAt,
    })
    .onConflictDoNothing({ target: messages.externalMessageId })
    .returning({ id: messages.id });

  if (!inserted) {
    // Otro webhook ganó la carrera por el mismo externalId.
    const [found] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.externalMessageId, message.externalId))
      .limit(1);
    if (!found) throw new Error("No se pudo guardar el mensaje entrante");
    return { conversationId: conversation.id, messageId: found.id, created: false };
  }

  await db
    .update(conversations)
    .set({ lastMessageAt: occurredAt, lastMessage: message.text, updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));
  if (message.direction === "inbound") {
    await db
      .update(conversations)
      .set({ unread: sql<number>`${conversations.unread} + 1` })
      .where(eq(conversations.id, conversation.id));
  } else {
    await db
      .update(conversations)
      .set({ firstResponseAt: sql<Date>`coalesce(${conversations.firstResponseAt}, ${occurredAt})` })
      .where(eq(conversations.id, conversation.id));
  }

  publishEvent(SSE_EVENTS.MESSAGE_CREATED, {
    conversationId: conversation.id,
    messageId: inserted.id,
    direction: message.direction,
    channel: message.channel,
  });
  publishEvent(SSE_EVENTS.CONVERSATION_UPDATED, {
    id: conversation.id,
    lastMessage: message.text,
    unread: message.direction === "inbound",
  });

  // Importación diferida para evitar el ciclo rules -> repository -> rules.
  // `evaluateRules` espera un RuleEvent: type / aggregateType / aggregateId / payload.
  try {
    const rulesModule = await import("@/lib/rules");
    const evaluate = (rulesModule as Record<string, unknown>).evaluateRules;
    if (typeof evaluate === "function") {
      await (evaluate as unknown as (event: {
        type: string;
        aggregateType: string;
        aggregateId: string;
        payload: Record<string, unknown>;
      }) => Promise<void>)({
        type: "message.received",
        aggregateType: "message",
        aggregateId: inserted.id,
        payload: {
          conversationId: conversation.id,
          messageId: inserted.id,
          contactId: contact.id,
          channel: message.channel,
          direction: message.direction,
          text: message.text,
        },
      });
    }
  } catch {
    // Las automatizaciones son una mejora: su fallo no debe rechazar el webhook.
  }

  return { conversationId: conversation.id, messageId: inserted.id, created: true };
}

// ---------------------------------------------------------------------------
// Mensajes salientes y dispatcher
// ---------------------------------------------------------------------------

export async function createOutboundMessage(input: {
  conversationId: string;
  channelId: string;
  recipient: string;
  body: string;
  authorType: "human" | "ai";
  status: "approved" | "queued";
  // La vista de aprobación devuelve `string | null`, así que aceptamos ambos.
  aiActionId?: string | null;
}): Promise<string> {
  const workspaceId = await getWorkspaceId();
  const [created] = await db
    .insert(outboundMessages)
    .values({
      workspaceId,
      conversationId: input.conversationId,
      channelId: input.channelId,
      recipient: input.recipient,
      body: input.body,
      authorType: input.authorType,
      status: input.status,
      idempotencyKey: randomUUID(),
      aiActionId: input.aiActionId ?? null,
      scheduledAt: input.status === "queued" ? new Date() : null,
    })
    .returning({ id: outboundMessages.id });

  if (input.aiActionId) {
    await db
      .update(aiActions)
      .set({ outboundMessageId: created.id })
      .where(eq(aiActions.id, input.aiActionId));
  }
  return created.id;
}

export type OutboundDue = typeof outboundMessages.$inferSelect;
export type OutboundStatus = "pending" | "approved" | "queued" | "sending" | "sent" | "failed" | "unknown";
export type OutboundPatch = {
  externalMessageId?: string;
  sentAt?: Date;
  error?: string | null;
  scheduledAt?: Date | null;
};

export async function listDueOutbound(limit: number): Promise<OutboundDue[]> {
  const workspaceId = await getWorkspaceId();
  return db
    .select()
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.workspaceId, workspaceId),
        inArray(outboundMessages.status, ["approved", "queued"]),
        isNull(outboundMessages.sentAt),
        or(isNull(outboundMessages.scheduledAt), lte(outboundMessages.scheduledAt, new Date())),
      ),
    )
    .orderBy(asc(outboundMessages.scheduledAt))
    .limit(clampLimit(limit, 50));
}

export async function markOutbound(id: string, status: OutboundStatus, patch: OutboundPatch = {}): Promise<void> {
  const set: Partial<typeof outboundMessages.$inferInsert> = { status, updatedAt: new Date() };
  if (patch.externalMessageId !== undefined) set.externalMessageId = patch.externalMessageId;
  if (patch.sentAt !== undefined) set.sentAt = patch.sentAt;
  else if (status === "sent") set.sentAt = new Date();
  if (patch.error !== undefined) set.error = patch.error;
  if (patch.scheduledAt !== undefined) set.scheduledAt = patch.scheduledAt;
  await db.update(outboundMessages).set(set).where(eq(outboundMessages.id, id));
}

// ---------------------------------------------------------------------------
// Auditoría y login
// ---------------------------------------------------------------------------

export type AuditLogView = {
  id: string;
  actor: string;
  action: string;
  resourceId: string;
  metadata: unknown;
  createdAt: string;
};

export async function recordAudit(actor: string, action: string, resourceId: string, metadata: unknown): Promise<void> {
  const workspaceId = await getWorkspaceId();
  await db.insert(auditLogs).values({ workspaceId, actor, action, resourceId, metadata });
}

export async function listAuditLogs(limit = 50): Promise<AuditLogView[]> {
  const rows = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(clampLimit(limit, 50));
  return rows.map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    resourceId: row.resourceId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Consulta que usa el endpoint de login: solo los campos necesarios para verificar la contraseña. */
export async function getAgentByEmail(
  email: string,
): Promise<{ id: string; email: string; passwordHash: string; name: string; role: string } | null> {
  const [row] = await db
    .select({
      id: agents.id,
      email: agents.email,
      passwordHash: agents.passwordHash,
      name: agents.displayName,
      role: agents.role,
    })
    .from(agents)
    .where(eq(agents.email, email))
    .limit(1);
  return row ?? null;
}
