/**
 * Esquema completo de Nexo en Drizzle (PostgreSQL).
 *
 * Convenciones:
 * - Tablas y columnas en camelCase (Drizzle las entrecomilla). Los adapters y el
 *   dispatcher usan SQL crudo con ese mismo nombre, así que no mezclar snake_case.
 * - Todas las tablas llevan `workspaceId` (aislamiento multi-workspace).
 * - IDs UUID generados por la base de datos; tiempos con zona horaria (UTC).
 * - Los campos `jsonb` se tipan con `$type` para no necesitar `any` en el resto del código.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

type CanonicalAttachment = { url: string; mime: string; name?: string };
type Citation = { title: string; url?: string };

// ---------------------------------------------------------------------------
// Núcleo: workspace, identidad y canales
// ---------------------------------------------------------------------------

export const workspaces = pgTable(
  "workspace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspace_slug_idx").on(t.slug)],
);

export const agents = pgTable(
  "agent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("passwordHash").notNull(),
    displayName: text("displayName").notNull(),
    role: text("role").notNull().default("agent"), // owner | admin | agent
    avatarUrl: text("avatarUrl"),
    active: boolean("active").notNull().default(true),
    lastSeenAt: timestamp("lastSeenAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_workspace_email_idx").on(t.workspaceId, t.email),
    index("agent_workspace_idx").on(t.workspaceId),
  ],
);

export const apiTokens = pgTable(
  "apiToken",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Guardamos solo el hash SHA-256 del token; el valor en claro se muestra una sola vez.
    tokenHash: text("tokenHash").notNull().unique(),
    lastUsedAt: timestamp("lastUsedAt", { withTimezone: true }),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_token_workspace_idx").on(t.workspaceId)],
);

export const channels = pgTable(
  "channel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // web | telegram | email | whatsapp | instagram
    externalIdentifier: text("externalIdentifier").notNull().default(""),
    // Configuración cifrada con AES-256-GCM (ver src/lib/crypto.ts). Nunca guardar secretos en claro.
    encryptedConfig: text("encryptedConfig").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastSyncAt: timestamp("lastSyncAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("channel_workspace_type_idx").on(t.workspaceId, t.type)],
);

// ---------------------------------------------------------------------------
// Contactos y atributos
// ---------------------------------------------------------------------------

export const contacts = pgTable(
  "contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    // Identificador del contacto en el canal de origen (telegram user id, email, wa id...).
    externalId: text("externalId").notNull(),
    displayName: text("displayName").notNull().default(""),
    email: text("email"),
    phone: text("phone"),
    avatarUrl: text("avatarUrl"),
    lifecycleStage: text("lifecycleStage").notNull().default("lead"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    lastSeenAt: timestamp("lastSeenAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_workspace_external_idx").on(t.workspaceId, t.externalId),
    index("contact_workspace_idx").on(t.workspaceId),
  ],
);

export const customAttributeDefinitions = pgTable(
  "customAttributeDefinition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: text("fieldType").notNull().default("text"),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    required: boolean("required").notNull().default(false),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("custom_attribute_workspace_key_idx").on(t.workspaceId, t.key)],
);

export const notes = pgTable(
  "note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    contactId: uuid("contactId").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    authorAgentId: uuid("authorAgentId").references(() => agents.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("note_contact_idx").on(t.contactId)],
);

// ---------------------------------------------------------------------------
// Equipos y SLA (se declaran antes de conversation por las foreign keys)
// ---------------------------------------------------------------------------

export const teams = pgTable(
  "team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_workspace_name_idx").on(t.workspaceId, t.name)],
);

export const teamMembers = pgTable(
  "teamMember",
  {
    teamId: uuid("teamId").notNull().references(() => teams.id, { onDelete: "cascade" }),
    agentId: uuid("agentId").notNull().references(() => agents.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.agentId] })],
);

export const slaPolicies = pgTable(
  "slaPolicy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    firstResponseMinutes: integer("firstResponseMinutes").notNull().default(60),
    resolutionMinutes: integer("resolutionMinutes").notNull().default(1440),
    businessHours: jsonb("businessHours").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sla_policy_workspace_idx").on(t.workspaceId)],
);

// ---------------------------------------------------------------------------
// Conversaciones y mensajes
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    // ID de la conversación en el canal de origen; permite reenviar el mismo hilo sin duplicarlo.
    externalId: text("externalId"),
    contactId: uuid("contactId").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    channelId: uuid("channelId").notNull().references(() => channels.id, { onDelete: "cascade" }),
    subject: text("subject"),
    status: text("status").notNull().default("open"), // open | pending | resolved
    priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
    assigneeAgentId: uuid("assigneeAgentId").references(() => agents.id, { onDelete: "set null" }),
    // Columna plana que usan las reglas de automatización al asignar.
    assigneeId: text("assigneeId"),
    // Las reglas `add_label` escriben aquí; la vista también cruza `conversationLabel`.
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    teamId: uuid("teamId").references(() => teams.id, { onDelete: "set null" }),
    slaPolicyId: uuid("slaPolicyId").references(() => slaPolicies.id, { onDelete: "set null" }),
    slaDueAt: timestamp("slaDueAt", { withTimezone: true }),
    slaWarnedAt: timestamp("slaWarnedAt", { withTimezone: true }),
    firstResponseAt: timestamp("firstResponseAt", { withTimezone: true }),
    resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
    lastMessageAt: timestamp("lastMessageAt", { withTimezone: true }).notNull().defaultNow(),
    lastMessage: text("lastMessage"),
    unread: integer("unread").notNull().default(0),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversation_status_last_message_idx").on(t.status, t.lastMessageAt),
    index("conversation_contact_idx").on(t.contactId),
    index("conversation_channel_idx").on(t.channelId),
    index("conversation_assignee_idx").on(t.assigneeAgentId),
    // Solo aplica cuando el canal envía un ID de conversación propio.
    uniqueIndex("conversation_external_idx")
      .on(t.workspaceId, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
);

export const messages = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(), // inbound | outbound
    senderType: text("senderType").notNull().default("contact"), // contact | agent | bot
    senderName: text("senderName"),
    senderAgentId: uuid("senderAgentId").references(() => agents.id, { onDelete: "set null" }),
    bodyText: text("bodyText"),
    bodyHtml: text("bodyHtml"),
    // Formato canónico del adapter; la tabla `attachment` guarda los objetos de S3 aparte.
    attachments: jsonb("attachments").$type<CanonicalAttachment[]>().notNull().default([]),
    // UPSERT por este campo: es la clave de deduplicación de webhooks.
    externalMessageId: text("externalMessageId").unique(),
    threadKey: text("threadKey"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurredAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("message_conversation_idx").on(t.conversationId),
    index("message_thread_idx").on(t.conversationId, t.threadKey),
    index("message_occurred_idx").on(t.occurredAt),
  ],
);

export const labels = pgTable(
  "label",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#6366f1"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("label_workspace_name_idx").on(t.workspaceId, t.name)],
);

export const conversationLabels = pgTable(
  "conversationLabel",
  {
    conversationId: uuid("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    labelId: uuid("labelId").notNull().references(() => labels.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.labelId] })],
);

// ---------------------------------------------------------------------------
// Eventos, automatizaciones y salida
// ---------------------------------------------------------------------------

export const events = pgTable(
  "event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    aggregateType: text("aggregateType").notNull(),
    aggregateId: text("aggregateId").notNull(),
    source: text("source").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    // Los webhooks pueden reenviar el mismo evento: esta clave evita procesarlo dos veces.
    dedupeKey: text("dedupeKey").notNull().unique(),
    processedAt: timestamp("processedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_type_created_idx").on(t.type, t.createdAt)],
);

export const automationRules = pgTable(
  "automationRule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // `active` es el nombre que consulta el motor de reglas (src/lib/rules.ts).
    active: boolean("active").notNull().default(true),
    trigger: text("trigger").notNull(),
    conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default({}),
    actions: jsonb("actions").$type<Record<string, unknown>[]>().notNull().default([]),
    priority: integer("priority").notNull().default(0),
    cooldownMinutes: integer("cooldownMinutes").notNull().default(0),
    lastRunAt: timestamp("lastRunAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("automation_rule_workspace_idx").on(t.workspaceId, t.active)],
);

export const ruleRuns = pgTable(
  "ruleRun",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    ruleId: uuid("ruleId").notNull().references(() => automationRules.id, { onDelete: "cascade" }),
    // Columnas que escribe el motor de reglas al registrar cada ejecución.
    eventType: text("eventType"),
    aggregateType: text("aggregateType"),
    aggregateId: text("aggregateId"),
    status: text("status"),
    durationMs: integer("durationMs"),
    eventId: uuid("eventId").references(() => events.id, { onDelete: "set null" }),
    conversationId: uuid("conversationId").references(() => conversations.id, { onDelete: "cascade" }),
    matched: boolean("matched").notNull().default(false),
    action: jsonb("action").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rule_run_rule_idx").on(t.ruleId), index("rule_run_conversation_idx").on(t.conversationId)],
);

export const outboundMessages = pgTable(
  "outboundMessage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    channelId: uuid("channelId").notNull().references(() => channels.id, { onDelete: "cascade" }),
    recipient: text("recipient").notNull(),
    body: text("body").notNull(),
    attachments: jsonb("attachments").$type<CanonicalAttachment[]>().notNull().default([]),
    authorType: text("authorType").notNull().default("human"), // human | ai
    status: text("status").notNull().default("pending"), // pending | approved | queued | sending | sent | failed | unknown
    // Un retry jamás debe enviar dos veces el mismo mensaje.
    idempotencyKey: text("idempotencyKey").notNull().unique(),
    // Los adapters la consultan para no reenviar la misma acción de IA.
    aiActionId: uuid("aiActionId"),
    scheduledAt: timestamp("scheduledAt", { withTimezone: true }),
    sentAt: timestamp("sentAt", { withTimezone: true }),
    externalMessageId: text("externalMessageId"),
    error: text("error"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outbound_status_scheduled_idx").on(t.status, t.scheduledAt),
    index("outbound_conversation_idx").on(t.conversationId),
  ],
);

export const attachments = pgTable(
  "attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    messageId: uuid("messageId").references(() => messages.id, { onDelete: "cascade" }),
    outboundMessageId: uuid("outboundMessageId").references(() => outboundMessages.id, { onDelete: "cascade" }),
    // Clave interna en S3/R2; la URL pública se deriva en src/lib/storage.ts.
    key: text("key").notNull(),
    url: text("url"),
    mime: text("mime").notNull().default("application/octet-stream"),
    name: text("name"),
    size: integer("size"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachment_message_idx").on(t.messageId), index("attachment_outbound_idx").on(t.outboundMessageId)],
);

export const aiActions = pgTable(
  "aiAction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    // El módulo de IA inserta estas columnas al proponer una respuesta.
    channelId: uuid("channelId"),
    recipient: text("recipient"),
    model: text("model"),
    promptTokens: integer("promptTokens").notNull().default(0),
    completionTokens: integer("completionTokens").notNull().default(0),
    costCents: real("costCents").notNull().default(0),
    confidence: real("confidence"),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    riskFlags: jsonb("riskFlags").$type<string[]>().notNull().default([]),
    proposalText: text("proposalText"),
    status: text("status").notNull().default("proposed"),
    // Sin FK para romper el ciclo aiAction <-> approval.
    approvalId: uuid("approvalId"),
    outboundMessageId: uuid("outboundMessageId"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_action_conversation_idx").on(t.conversationId)],
);

export const approvals = pgTable(
  "approval",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    // Opcional en la creación: si no llega, se resuelve desde la conversación.
    channelId: uuid("channelId").references(() => channels.id, { onDelete: "set null" }),
    recipient: text("recipient").notNull().default(""),
    aiActionId: uuid("aiActionId").references(() => aiActions.id, { onDelete: "set null" }),
    actionType: text("actionType").notNull(),
    resourceId: text("resourceId").notNull(),
    proposedText: text("proposedText").notNull(),
    editedText: text("editedText"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | expired
    approverAgentId: uuid("approverAgentId").references(() => agents.id, { onDelete: "set null" }),
    callbackTokenHash: text("callbackTokenHash").notNull().unique(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decidedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("approval_status_created_idx").on(t.status, t.createdAt),
    index("approval_conversation_idx").on(t.conversationId),
  ],
);

export const aiAudits = pgTable(
  "aiAudit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    // Columnas que inserta el módulo de IA.
    actionType: text("actionType"),
    resourceId: text("resourceId"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    aiActionId: uuid("aiActionId"),
    conversationId: uuid("conversationId").references(() => conversations.id, { onDelete: "cascade" }),
    model: text("model"),
    prompt: text("prompt"),
    response: text("response"),
    promptTokens: integer("promptTokens").notNull().default(0),
    completionTokens: integer("completionTokens").notNull().default(0),
    costCents: real("costCents").notNull().default(0),
    latencyMs: integer("latencyMs").notNull().default(0),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_audit_conversation_idx").on(t.conversationId)],
);

export const auditLogs = pgTable(
  "auditLog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    resourceId: text("resourceId").notNull(),
    metadata: jsonb("metadata").$type<unknown>().notNull().default({}),
    ip: text("ip"),
    userAgent: text("userAgent"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_workspace_created_idx").on(t.workspaceId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Base de conocimiento y webhooks
// ---------------------------------------------------------------------------

export const kbDocuments = pgTable(
  "kbDocument",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    sourcePath: text("sourcePath"),
    contentHash: text("contentHash"),
    text: text("text").notNull().default(""),
    /**
     * pgvector. En drizzle-orm 0.44 la firma es `vector(name, { dimensions })`
     * (la forma posicional `vector(name, 1536)` ya no está en los tipos).
     * La migración debe ejecutar antes: CREATE EXTENSION IF NOT EXISTS vector;
     */
    embedding: vector("embedding", { dimensions: 1536 }),
    tags: text("tags").array().notNull().default([]),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kb_document_workspace_slug_idx").on(t.workspaceId, t.slug)],
);

export const webhookSubscriptions = pgTable(
  "webhookSubscription",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    events: text("events").array().notNull().default([]),
    secretHash: text("secretHash"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_subscription_workspace_idx").on(t.workspaceId)],
);

export const webhookDeliveries = pgTable(
  "webhookDelivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspaceId").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    eventId: uuid("eventId").references(() => events.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseCode: integer("responseCode"),
    nextAttemptAt: timestamp("nextAttemptAt", { withTimezone: true }),
    deliveredAt: timestamp("deliveredAt", { withTimezone: true }),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_delivery_status_next_idx").on(t.status, t.nextAttemptAt)],
);

// ---------------------------------------------------------------------------
// Tipos inferidos (los consume la capa de repositorio)
// ---------------------------------------------------------------------------

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type CustomAttributeDefinition = typeof customAttributeDefinitions.$inferSelect;
export type NewCustomAttributeDefinition = typeof customAttributeDefinitions.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type SlaPolicy = typeof slaPolicies.$inferSelect;
export type NewSlaPolicy = typeof slaPolicies.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;
export type ConversationLabel = typeof conversationLabels.$inferSelect;
export type NewConversationLabel = typeof conversationLabels.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type AutomationRule = typeof automationRules.$inferSelect;
export type NewAutomationRule = typeof automationRules.$inferInsert;
export type RuleRun = typeof ruleRuns.$inferSelect;
export type NewRuleRun = typeof ruleRuns.$inferInsert;
export type OutboundMessage = typeof outboundMessages.$inferSelect;
export type NewOutboundMessage = typeof outboundMessages.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
export type AiAction = typeof aiActions.$inferSelect;
export type NewAiAction = typeof aiActions.$inferInsert;
export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
export type AiAudit = typeof aiAudits.$inferSelect;
export type NewAiAudit = typeof aiAudits.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type KbDocument = typeof kbDocuments.$inferSelect;
export type NewKbDocument = typeof kbDocuments.$inferInsert;
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type NewWebhookSubscription = typeof webhookSubscriptions.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
