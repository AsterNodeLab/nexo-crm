import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyToken } from "@/lib/auth";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function bad(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("BODY_INVALID");
  }
}

/**
 * En desarrollo no bloqueamos para poder probar el inbox sin login.
 * En producción, si el JWT_SECRET es real, exigimos sesión. El widget y los
 * webhooks tienen su propia autenticación y no usan esta función.
 */
export async function requireSession(req: Request): Promise<Response | null> {
  const production = env.NODE_ENV === "production";
  const configured = env.JWT_SECRET !== "dev-only-change-me";
  if (!production || !configured) return null;

  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)nexo_token=([^;]+)/);
  if (!match) return bad("UNAUTHORIZED", "Inicia sesión para continuar.", 401);

  try {
    await verifyToken(decodeURIComponent(match[1]));
    return null;
  } catch {
    return bad("UNAUTHORIZED", "Sesión vencida.", 401);
  }
}

export function handleError(error: unknown) {
  const message = error instanceof Error ? error.message : "Error desconocido";
  if (message === "BODY_INVALID") return bad("BODY_INVALID", "El cuerpo de la petición debe ser JSON válido.", 400);
  if (message === "UNAUTHORIZED") return bad("UNAUTHORIZED", "No autorizado.", 401);
  console.error("[api]", message);
  return bad("INTERNAL_ERROR", "Ocurrió un error inesperado.", 500);
}
