/**
 * Autenticación de agentes: contraseñas con bcrypt y sesiones JWT HS256 (jose).
 * El token viaja en la cookie `nexo_token` o en `Authorization: Bearer`.
 */
import { compare, hash } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { agents, type Agent } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const TOKEN_COOKIE = "nexo_token";
const TOKEN_TTL = "7d";
const secretKey = new TextEncoder().encode(env.JWT_SECRET);
const ClaimsSchema = z.object({ agentId: z.string().uuid() });

export type AuthError = Error & { code: string };

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, 12);
}

export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  try {
    return await compare(plain, passwordHash);
  } catch {
    return false;
  }
}

/** Devuelve un JWT firmado. Guardar el `agentId` en el claim evita consultar por email. */
export async function signToken(agentId: string): Promise<string> {
  return new SignJWT({ agentId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secretKey);
}

/** Verifica firma y expiración. Devuelve el agentId, o null si el token no sirve. */
export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    const parsed = ClaimsSchema.safeParse(payload);
    return parsed.success ? parsed.data.agentId : null;
  } catch {
    return null;
  }
}

function readToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  const cookies = req.headers.get("cookie");
  if (cookies) {
    for (const part of cookies.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === TOKEN_COOKIE) {
        try {
          return decodeURIComponent(rest.join("="));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Resuelve el agente autenticado de la petición; null cuando no hay sesión válida. */
export async function getAgentFromRequest(req: Request): Promise<Agent | null> {
  const token = readToken(req);
  if (!token) return null;
  const agentId = await verifyToken(token);
  if (!agentId) return null;
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    return agent && agent.active ? agent : null;
  } catch {
    return null;
  }
}

/** Igual que getAgentFromRequest pero falla con `code = UNAUTHORIZED`. */
export async function requireAgent(req: Request): Promise<Agent> {
  const agent = await getAgentFromRequest(req);
  if (!agent) {
    const error = new Error("Se requiere autenticación") as AuthError;
    error.code = "UNAUTHORIZED";
    throw error;
  }
  return agent;
}
