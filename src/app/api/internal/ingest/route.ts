import { CanonicalMessageSchema } from "@/lib/contracts";
import { env } from "@/lib/env";
import { ingestCanonicalMessage } from "@/lib/repository";
import { ok, bad, handleError } from "../../_lib/http";

export const dynamic = "force-dynamic";

/** Uso interno: adapters y scripts. Nunca expone credenciales de envío. */
export async function POST(req: Request) {
  try {
    const token = req.headers.get("x-ingest-token");
    if (!token || token !== env.INGEST_TOKEN) return bad("UNAUTHORIZED", "Token de ingesta inválido.", 401);
    const parsed = CanonicalMessageSchema.parse(await req.json());
    return ok(await ingestCanonicalMessage(parsed), 202);
  } catch (error) {
    return handleError(error);
  }
}
