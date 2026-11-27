import { getAgentByEmail } from "@/lib/repository";
import { verifyPassword, signToken } from "@/lib/auth";
import { ok, bad, body, handleError } from "../../_lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { email, password } = await body<{ email?: string; password?: string }>(req);
    if (!email || !password) return bad("MISSING_CREDENTIALS", "Email y contraseña son obligatorios.", 400);
    const agent = await getAgentByEmail(email.toLowerCase().trim());
    if (!agent || !(await verifyPassword(password, agent.passwordHash))) {
      return bad("INVALID_CREDENTIALS", "Credenciales incorrectas.", 401);
    }
    const token = await signToken(agent.id);
    const response = ok({ id: agent.id, name: agent.name, role: agent.role });
    response.cookies.set("nexo_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return response;
  } catch (error) {
    return handleError(error);
  }
}
