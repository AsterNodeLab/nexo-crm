import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { automationRules, conversationLabels, conversations, labels, ruleRuns } from "@/db/schema";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events";
import { asRecord, field, getWorkspaceId, text } from "@/lib/channels/support";
import type { Row } from "@/lib/channels/support";

export type RuleEvent = {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
};

type Condition = { field: string; operator: string; value?: unknown };
type RuleAction = { type: string; value?: unknown } & Row;
type NormalizedEvent = Required<RuleEvent>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El repository dispara las reglas con un evento acotado (conversationId,
 * text, channel, direction). Lo normalizamos al contrato completo sin perder
 * compatibilidad con quien llama con type/aggregateType/payload.
 */
function normalizeEvent(event: RuleEvent): NormalizedEvent {
  const raw = asRecord(event);
  const conversationId = text(raw.conversationId);
  return {
    type: text(raw.type) || "message.created",
    aggregateType: text(raw.aggregateType) || (conversationId ? "conversation" : ""),
    aggregateId: text(raw.aggregateId) || conversationId,
    payload: asRecord(raw.payload ?? raw),
  };
}

function getPath(payload: Row, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Row)[key];
  }, payload);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "string") return String(a) === b;
  if (typeof b === "number" && typeof a === "string") return String(b) === a;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Operadores simples sobre el payload; los desconocidos fallan cerrados. */
export function matchesConditions(conditions: unknown, payload: Row): boolean {
  let items: Condition[] = [];
  if (Array.isArray(conditions)) {
    items = conditions.map((item) => {
      const row = asRecord(item);
      return {
        field: text(field(row, "field", "path", "key")),
        operator: text(field(row, "operator", "op")) || "equals",
        value: field(row, "value"),
      };
    });
  } else if (conditions !== null && typeof conditions === "object") {
    items = Object.entries(conditions as Row).map(([key, rawValue]) => {
      const value = asRecord(rawValue);
      const hasOperator = Object.prototype.hasOwnProperty.call(value, "operator");
      return {
        field: key,
        operator: hasOperator ? text(value.operator) : "equals",
        value: hasOperator ? value.value : rawValue,
      };
    });
  }

  return items.every((condition) => {
    if (!condition.field) return true;
    const actual = getPath(payload, condition.field);
    switch (condition.operator) {
      case "equals":
        return sameValue(actual, condition.value);
      case "contains":
        if (typeof actual === "string") return actual.includes(text(condition.value));
        if (Array.isArray(actual)) return actual.some((item) => sameValue(item, condition.value));
        if (actual !== null && typeof actual === "object") {
          return Object.prototype.hasOwnProperty.call(actual as Row, text(condition.value));
        }
        return false;
      case "in": {
        const allowed = Array.isArray(condition.value) ? condition.value : [condition.value];
        return allowed.some((item) => sameValue(actual, item));
      }
      case "exists": {
        const present = actual !== undefined && actual !== null;
        if (condition.value === undefined) return present;
        if (typeof condition.value === "boolean") return condition.value ? present : !present;
        return present === Boolean(condition.value);
      }
      default:
        return false;
    }
  });
}

function normalizeActions(actions: unknown): RuleAction[] {
  if (Array.isArray(actions)) {
    return actions.map((item) => {
      const row = asRecord(item);
      return { ...row, type: text(field(row, "type", "action")) };
    });
  }
  if (actions !== null && typeof actions === "object") {
    return Object.entries(actions as Row).map(([type, rawValue]) => {
      const value = asRecord(rawValue);
      if (Object.keys(value).length > 0) return { ...value, type };
      return { type, value: rawValue };
    });
  }
  return [];
}

async function loadRules(): Promise<typeof automationRules.$inferSelect[]> {
  try {
    const workspaceId = await getWorkspaceId();
    return await db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.active, true), eq(automationRules.workspaceId, workspaceId)))
      .orderBy(asc(automationRules.priority));
  } catch {
    return [];
  }
}

/** Las etiquetas viven en su propia tabla; no hay columna `labels` en conversation. */
async function addLabel(conversationId: string, value: unknown): Promise<void> {
  const name = text(value);
  if (!name || !UUID_PATTERN.test(conversationId)) return;
  const workspaceId = await getWorkspaceId();
  let [label] = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), eq(labels.name, name)))
    .limit(1);
  if (!label) {
    [label] = await db
      .insert(labels)
      .values({ workspaceId, name })
      .onConflictDoNothing()
      .returning({ id: labels.id });
  }
  if (!label) return;
  await db
    .insert(conversationLabels)
    .values({ conversationId, labelId: label.id })
    .onConflictDoNothing();
}

async function executeActions(actions: RuleAction[], event: NormalizedEvent): Promise<void> {
  const conversationId = event.aggregateType === "conversation" ? event.aggregateId : "";

  for (const action of actions) {
    switch (action.type) {
      case "add_label": {
        if (conversationId) await addLabel(conversationId, action.value ?? action.label ?? action.name);
        break;
      }
      case "assign": {
        if (!conversationId || !UUID_PATTERN.test(conversationId)) break;
        const assignee = text(action.value ?? action.agentId ?? action.assigneeId);
        if (!UUID_PATTERN.test(assignee)) break;
        await db
          .update(conversations)
          .set({ assigneeAgentId: assignee, updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));
        break;
      }
      case "set_priority": {
        if (!conversationId || !UUID_PATTERN.test(conversationId)) break;
        const priority = text(action.value ?? action.priority);
        if (!["low", "normal", "high", "urgent"].includes(priority)) break;
        await db
          .update(conversations)
          .set({ priority, updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));
        break;
      }
      case "reply_with_ai": {
        if (!conversationId) break;
        // Carga diferida: rules.ts se usa en la ingesta y ai.ts importa del canal.
        const { proposeReply } = await import("@/lib/ai");
        await proposeReply(conversationId);
        break;
      }
      case "notify": {
        publishEvent("rule.notify", {
          ruleEvent: event.type,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          conversationId,
          message: text(action.message ?? action.text ?? action.value),
        });
        break;
      }
      default:
        break;
    }
  }
}

async function recordRun(input: {
  ruleId: string;
  event: NormalizedEvent;
  status: "success" | "failed";
  error: string;
  durationMs: number;
}): Promise<void> {
  try {
    const workspaceId = await getWorkspaceId();
    await db.insert(ruleRuns).values({
      workspaceId,
      ruleId: input.ruleId,
      conversationId: UUID_PATTERN.test(input.event.aggregateId) ? input.event.aggregateId : null,
      eventType: input.event.type,
      aggregateType: input.event.aggregateType,
      aggregateId: input.event.aggregateId,
      status: input.status,
      durationMs: input.durationMs,
      matched: true,
      action: { outcome: input.status },
      error: input.error || null,
    });
  } catch {
    // Si falla el registro no queremos romper la ingesta que disparó la regla.
  }
}

/**
 * Las reglas son best-effort: cualquier error se publica como `rule.failed`
 * pero nunca se propaga al pipeline de ingesta.
 */
export async function evaluateRules(event: RuleEvent): Promise<void> {
  try {
    const normalized = normalizeEvent(event);
    const rules = await loadRules();
    const payload = normalized.payload;

    for (const rule of rules) {
      if (!matchesConditions(rule.conditions, payload)) continue;

      const startedAt = Date.now();
      try {
        await executeActions(normalizeActions(rule.actions), normalized);
        await recordRun({
          ruleId: rule.id,
          event: normalized,
          status: "success",
          error: "",
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordRun({
          ruleId: rule.id,
          event: normalized,
          status: "failed",
          error: message.slice(0, 500),
          durationMs: Date.now() - startedAt,
        });
        try {
          publishEvent("rule.failed", { ruleId: rule.id, event: normalized, error: message });
        } catch {
          // El bus de eventos tampoco debe romper la ingesta.
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      publishEvent("rule.failed", { scope: "load", event, error: message });
    } catch {
      // Best-effort.
    }
  }
}

/** Exports de apoyo para pruebas y diagnóstico. */
export const ruleInternals = { getPath, normalizeActions, normalizeEvent, sameValue };
