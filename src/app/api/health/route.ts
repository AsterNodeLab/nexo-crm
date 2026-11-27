import { ok } from "../_lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok({
    status: "ok",
    service: "nexo",
    time: new Date().toISOString(),
  });
}
