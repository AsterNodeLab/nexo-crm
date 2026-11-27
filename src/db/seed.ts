/**
 * Seed idempotente: workspace, agente owner y canal web.
 * Ejecutar con: npx tsx src/db/seed.ts
 * La contraseña del owner se puede override con SEED_OWNER_PASSWORD (o NEXO_OWNER_PASSWORD).
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { encryptConfig } from "../lib/crypto";
import { closeDb, db } from "../lib/db";
import { agents, channels, workspaces } from "./schema";

const WORKSPACE_SLUG = "nexo";
const OWNER_EMAIL = "owner@nexo.local";
const DEFAULT_PASSWORD = "nexo123";

export async function seed(): Promise<void> {
  let [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, WORKSPACE_SLUG)).limit(1);
  if (!workspace) {
    [workspace] = await db
      .insert(workspaces)
      .values({ name: "Nexo", slug: WORKSPACE_SLUG })
      .onConflictDoNothing()
      .returning();
  }
  if (!workspace) {
    [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, WORKSPACE_SLUG)).limit(1);
  }
  if (!workspace) throw new Error("No se pudo crear el workspace inicial");

  const [existingOwner] = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, OWNER_EMAIL)).limit(1);
  if (!existingOwner) {
    await db
      .insert(agents)
      .values({
        workspaceId: workspace.id,
        email: OWNER_EMAIL,
        passwordHash: await hashPassword(
          process.env.SEED_OWNER_PASSWORD ?? process.env.NEXO_OWNER_PASSWORD ?? DEFAULT_PASSWORD,
        ),
        displayName: "Owner",
        role: "owner",
        active: true,
      })
      .onConflictDoNothing();
  }

  const [existingWebChannel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.workspaceId, workspace.id), eq(channels.type, "web")))
    .limit(1);
  if (!existingWebChannel) {
    await db
      .insert(channels)
      .values({
        workspaceId: workspace.id,
        type: "web",
        externalIdentifier: "",
        encryptedConfig: encryptConfig({
          widgetTitle: "¿En qué podemos ayudarte?",
          allowedOrigins: "",
        }),
        enabled: true,
      })
      .onConflictDoNothing();
  }

  // No imprimimos la contraseña ni ningún secreto.
  console.log("Seed completo: workspace 'nexo', agente owner@nexo.local y canal web.");
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedDirectly) {
  void seed()
    .catch((error: unknown) => {
      console.error("Error en el seed:", error instanceof Error ? error.message : "error desconocido");
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
