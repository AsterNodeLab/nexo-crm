import { getContact, updateContact } from "@/lib/repository";
import { ok, bad, body, handleError, requireSession } from "../../_lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    const { id } = await params;
    const contact = await getContact(id);
    if (!contact) return bad("NOT_FOUND", "Contacto no encontrado.", 404);
    return ok(contact);
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const denied = await requireSession(req);
    if (denied) return denied;
    const { id } = await params;
    const patch = await body(req);
    await updateContact(id, patch);
    return ok(await getContact(id));
  } catch (error) {
    return handleError(error);
  }
}
