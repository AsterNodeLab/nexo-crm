import { createHmac } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { contacts, conversations, workspaces } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashToken, safeEqual } from "@/lib/crypto";

/** Fila devuelta por drizzle postgres-js (o por el objeto { rows } de otros drivers). */
export type Row = Record<string, unknown>;

/**
 * Normaliza las dos formas en que drizzle devuelve `db.execute`: un array de
 * filas (postgres-js) o un objeto con `rows` (node-postgres). Así el mismo
 * código sirve en local y en Vercel aunque cambie el driver.
 */
export function rowsFromResult(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as Row[];
  }
  return [];
}

export async function queryRows(query: SQL): Promise<Row[]> {
  return rowsFromResult(await db.execute(query));
}

export function asRecord(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}

/**
 * Lee un campo tolerando camelCase y snake_case: el esquema de drizzle puede
 * exponer `channelId` o `channel_id` según cómo se haya declarado la columna.
 */
export function field(row: Row, ...names: string[]): unknown {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null) return row[name];
  }
  for (const name of names) {
    const snake = name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (row[snake] !== undefined && row[snake] !== null) return row[snake];
  }
  return undefined;
}

export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

export function integer(value: unknown, fallback = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function decimal(value: unknown, fallback = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

export function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Hash del token de aprobación. Usamos el mismo secreto del servidor para que
 * el token nunca viaje a la BD: solo se guarda su digest.
 */
export function hashCallbackToken(token: string): string {
  return hashToken(token);
}

/** Todas las tablas llevan workspaceId; el seed garantiza exactamente uno. */
export async function getWorkspaceId(): Promise<string> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  if (!row) throw new Error("No existe un workspace configurado. Ejecuta el seed primero.");
  return row.id;
}

/** Comparación en tiempo constante con la firma `sha256=<hex>` que envía Meta. */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  try {
    return safeEqual(signatureHeader, expected);
  } catch {
    return false;
  }
}

const bodyCache = new WeakMap<Request, string>();

/**
 * Los handlers de Next leen el body antes de llamar al adapter. Como un
 * Request solo se puede consumir una vez, guardamos el texto crudo para que
 * `parse` pueda reutilizarlo sin depender del orden de llamadas del route.
 */
export async function readRawBody(request: Request): Promise<string> {
  const cached = bodyCache.get(request);
  if (cached !== undefined) return cached;
  const raw = await request.clone().text();
  bodyCache.set(request, raw);
  return raw;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await readRawBody(request);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("INVALID_JSON_BODY");
  }
}

const UUID_PATTERN = /^[0-9a-f]{32}$/i;

/** Los UUID van en base64url para que `callback_data` quede por debajo de 64 bytes. */
function uuidToTag(uuid: string): string {
  const hex = uuid.replace(/-/g, "");
  if (!UUID_PATTERN.test(hex)) throw new Error("INVALID_UUID");
  return Buffer.from(hex, "hex").toString("base64url");
}

function tagToUuid(tag: string): string | null {
  try {
    const hex = Buffer.from(tag, "base64url").toString("hex");
    if (!UUID_PATTERN.test(hex)) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

export type ApprovalAction = "approve" | "edit" | "reject";
export type CallbackData = { approvalId: string; action: ApprovalAction; token: string };

const ACTION_CODES: Record<ApprovalAction, string> = { approve: "a", edit: "e", reject: "r" };
const CODE_ACTIONS: Record<string, ApprovalAction> = { a: "approve", e: "edit", r: "reject" };

export function encodeCallbackData(data: CallbackData): string {
  return `n:${uuidToTag(data.approvalId)}:${ACTION_CODES[data.action]}:${uuidToTag(data.token)}`;
}

export function decodeCallbackData(raw: string | undefined | null): CallbackData | null {
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length !== 4 || parts[0] !== "n") return null;
  const approvalId = tagToUuid(parts[1] ?? "");
  const action = CODE_ACTIONS[parts[2] ?? ""];
  const token = tagToUuid(parts[3] ?? "");
  if (!approvalId || !action || !token) return null;
  return { approvalId, action, token };
}

/**
 * Resuelve el canal y el destinatario de una conversación. Se necesita para
 * crear la propuesta de IA con la ruta de salida ya resuelta: quien aprueba
 * después no tiene que adivinar a qué chat responder.
 */
export async function resolveRouting(
  conversationId: string,
): Promise<{ channelId: string; recipient: string }> {
  try {
    const [row] = await db
      .select({
        channelId: conversations.channelId,
        email: contacts.email,
        phone: contacts.phone,
        externalId: contacts.externalId,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!row) return { channelId: "", recipient: "" };
    return {
      channelId: row.channelId,
      recipient: row.email ?? row.phone ?? row.externalId,
    };
  } catch {
    return { channelId: "", recipient: "" };
  }
}
