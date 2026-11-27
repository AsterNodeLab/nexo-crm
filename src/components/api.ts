/**
 * Capa fina de acceso a la API. Todas las rutas devuelven { data } o { error }.
 * Centralizar el parseo evita repetir manejo de errores en cada pantalla.
 */

function readErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error: unknown = body.error;
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  return typeof error.message === "string" ? error.message : null;
}

export async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch {
    throw new Error("No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`El servidor devolvió una respuesta inesperada (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(readErrorMessage(body) ?? `No se pudo completar la solicitud (${response.status}).`);
  }

  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export function jsonRequest<T>(method: "POST" | "PUT" | "PATCH", body: T): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Aviso global para que el contador de aprobaciones se actualice al decidir. */
export const REFRESH_EVENT = "nexo:refresh";

export function notifyRefresh(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFRESH_EVENT));
}
