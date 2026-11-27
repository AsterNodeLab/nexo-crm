/**
 * Almacenamiento de archivos compatible con S3, MinIO local y R2.
 * El servidor genera todas las claves: la entrada del usuario nunca decide la ruta.
 */
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT || undefined,
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

/** Valida y normaliza una clave: prohibimos `..`, barras iniciales y caracteres raros. */
function safeKey(key: string): string {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    /[^A-Za-z0-9._/-]/.test(normalized) ||
    segments.some((s) => s === "" || s === "." || s === "..")
  ) {
    throw new Error("Clave de objeto inválida");
  }
  return normalized;
}

/** Genera una clave servidor:<workspace>/<año>/<mes>/<uuid>-<nombre sanificado>. */
export function buildObjectKey(scope: string, filename: string): string {
  const now = new Date();
  const cleanName = filename
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(-80);
  const prefix = safeKey(scope);
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${prefix}/${datePath}/${randomUUID()}${cleanName ? `-${cleanName}` : ""}`;
}

export async function putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
  const safe = safeKey(key);
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: safe,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    }),
  );
}

/**
 * URL pública del objeto. Los buckets se crean con lectura pública; si se necesitan
 * URLs privadas, este es el punto donde se usaría un presigner.
 */
export function getObjectUrl(key: string): string {
  const safe = safeKey(key);
  const endpoint = env.S3_ENDPOINT.replace(/\/$/, "");
  if (!endpoint) return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${safe}`;
  // Con path-style el bucket va en la ruta (MinIO). En R2 el endpoint ya incluye la cuenta.
  return env.S3_FORCE_PATH_STYLE === "true"
    ? `${endpoint}/${env.S3_BUCKET}/${safe}`
    : `${endpoint}/${safe}`;
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: safeKey(key) }));
}

export { s3 };
