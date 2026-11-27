/**
 * Utilidades criptográficas del núcleo.
 * La configuración de canales se cifra con AES-256-GCM: además de confidencialidad
 * da autenticidad, así detectamos si alguien cambió el ciphertext a mano.
 * Nunca se loguean claves, tokens ni texto plano.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION = "v1";
const MASK = "••••••";

// sha256 de 32 bytes => clave exacta de AES-256. Derivarla evita usar el secret directamente.
const encryptionKey = createHash("sha256").update(env.JWT_SECRET, "utf8").digest();

/** Cifra cualquier valor serializable. Formato: v1.<iv>.<tag>.<ciphertext>, todo base64url. */
export function encryptConfig(value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);
  const plain = Buffer.from(JSON.stringify(value ?? null), "utf8");
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

/** Descifra y parsea la configuración. Lanza si el formato o el tag no son válidos. */
export function decryptConfig<T>(raw: string): T {
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Configuración cifrada inválida");
  }
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const payload = Buffer.from(parts[3], "base64url");
    const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
    decipher.setAuthTag(tag);
    const clear = Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(clear);
    return parsed as T;
  } catch {
    // No incluimos el error original: podría filtrar fragmentos del secreto.
    throw new Error("No se pudo descifrar la configuración del canal");
  }
}

/** Hash deterministico para guardar tokens sin guardar el token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Comparación en tiempo constante: primero fijamos la longitud con un hash. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

/** Máscara que la UI envía cuando el usuario no quiere cambiar un secreto. */
export function isMaskedSecret(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && /^[•]+$/.test(value);
}

export { MASK };
