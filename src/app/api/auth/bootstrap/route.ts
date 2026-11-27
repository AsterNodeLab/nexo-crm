import { seed } from "@/db/seed";
import { ok, handleError } from "../../_lib/http";

export const dynamic = "force-dynamic";

/** Arranque inicial: crea workspace, agente owner y canal web. Idempotente. */
export async function POST() {
  try {
    await seed();
    return ok({ bootstrapped: true });
  } catch (error) {
    return handleError(error);
  }
}
