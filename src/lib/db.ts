/**
 * Única instancia de la base de datos para todo el proceso.
 * La guardamos en `globalThis` para que el hot-reload de Next.js y los
 * serverless warm starts reutilicen la conexión en vez de abrir una nueva.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";

type DbClient = ReturnType<typeof postgres>;

const globalForDb = globalThis as typeof globalThis & {
  __nexoDbClient?: DbClient;
  __nexoDb?: PostgresJsDatabase<typeof schema>;
};

function createClient(): DbClient {
  return postgres(env.DATABASE_URL, {
    max: env.NODE_ENV === "production" ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

const client = globalForDb.__nexoDbClient ?? createClient();
globalForDb.__nexoDbClient = client;

export const db: PostgresJsDatabase<typeof schema> =
  globalForDb.__nexoDb ?? drizzle<typeof schema>(client, { schema });
globalForDb.__nexoDb = db;

export { sql };

/** Cierra el pool. Útil en scripts y pruebas; en la app web no se llama. */
export async function closeDb(): Promise<void> {
  await client.end();
  delete globalForDb.__nexoDb;
  delete globalForDb.__nexoDbClient;
}
