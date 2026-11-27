import { getChannelConfig } from "@/lib/repository";
import { getInboundAdapter } from "@/lib/channels";
import { ingestCanonicalMessage } from "@/lib/repository";
import { ok, bad, handleError } from "../../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const channel = await getChannelConfig("instagram");
  const expected = String(channel?.config.verifyToken ?? "");
  if (mode === "subscribe" && token && expected && token === expected) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return bad("VERIFICATION_FAILED", "Token de verificación incorrecto.", 403);
}

export async function POST(req: Request) {
  try {
    const channel = await getChannelConfig("instagram");
    if (!channel) return bad("CHANNEL_NOT_CONFIGURED", "Instagram no está configurado.", 503);
    const raw = await req.text();
    const adapter = getInboundAdapter("instagram");
    const signed = new Request(req.url, { method: "POST", body: raw, headers: req.headers });
    if (!(await adapter.verify(signed, channel.config))) {
      return bad("INVALID_SIGNATURE", "Firma de Meta inválida.", 401);
    }
    const messages = await adapter.parse(signed, channel.config);
    for (const message of messages) await ingestCanonicalMessage(message);
    return ok({ ingested: messages.length });
  } catch (error) {
    return handleError(error);
  }
}
