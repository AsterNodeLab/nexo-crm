# Despliegue de Nexo en Vercel

> **Estado real del repo (26 Nov 2026):** no hay `node_modules`, lockfile ni `src/db/schema.ts`. No se ha ejecutado `npm install` ni `next build`. Los pasos siguientes son el procedimiento previsto; el build **no está verificado**. No hay rutas API ni `app/page.tsx`, así que hoy el deploy serviría una raíz 404.

## 1. Preparación local

1. `npm install` (genera `package-lock.json`; **confirmarlo en Git** para builds reproducibles).
2. Copia `.env.example` a `.env.local` y rellena los valores. Nunca subas `.env.local` a Git (`.gitignore` ya lo cubre).
3. Crea `src/db/schema.ts` y genera la primera migración con `npm run db:generate`. `drizzle.config.ts` apunta a `./src/db/schema.ts` y escribe en `./drizzle`.
4. Comprueba `npm run typecheck` y `npm test` antes de desplegar.

## 2. Base de datos

1. En Vercel: **Add New → Marketplace → Postgres** (Neon o Supabase). Vercel inyecta la cadena de conexión como variable de entorno.
2. Usa **dos cadenas**:
   - `DATABASE_URL`: la **pooled** (en Neon, hostname con `-pooler`; en Supabase, shared pooler transaction, puerto `6543`). La usa la app en runtime.
   - `DIRECT_URL`: la **directa**. La usan `drizzle-kit` y `pg_dump`/`pg_restore`.
3. En el cliente, crea el pool **una sola vez a nivel de módulo**: `postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: "require" })`. `prepare: false` evita prepared statements en poolers que no los soportan; `max: 1` evita agotar conexiones por instancia caliente.
4. Ejecuta las migraciones **antes** de activar tráfico, con la cadena directa:

```bash
$env:DATABASE_URL = "<CADENA_DIRECTA>"
npx drizzle-kit migrate
```

   Si el proyecto aún no tiene `drizzle-kit migrate` configurado para producción, una alternativa aceptada es ejecutar el SQL generado en `drizzle/` desde el panel de Neon/Supabase con la conexión directa. **No ejecutar migraciones con la cadena `-pooler`**: en modo transaction puede fallar.

## 3. Variables de entorno en Vercel

Project → Settings → Environment Variables. Copiar todos los bloques de `.env.example`, con estos criterios:

| Bloque | Variables | Valor en producción |
|---|---|---|
| Núcleo | `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `APP_URL`, `INGEST_TOKEN`, `CRON_SECRET` | Secretos aleatorios reales. `APP_URL` = `https://<dominio>`. Los defaults de `src/lib/env.ts` (`dev-only-change-me`, `dev-cron-secret`, etc.) **no son seguros en producción**. |
| IA | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `EMBEDDING_MODEL`, `AI_ENABLED`, `AI_MAX_TOKENS`, `AI_PROPOSAL_TTL_MINUTES`, `AI_MONTHLY_BUDGET_USD` | La key real; modelo por defecto `openai/gpt-4o-mini`, embeddings `openai/text-embedding-3-small`. |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_APPROVER_CHAT_IDS` | Ver `docs/canales.md`. El `secret_token` debe coincidir con `TELEGRAM_WEBHOOK_SECRET`. |
| WhatsApp | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_VERSION` | Versión actualizada a `v23.0`. Verificar changelog antes de subirla. |
| Instagram | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`, `INSTAGRAM_API_VERSION` | Ver `docs/canales.md`. |
| Email | `EMAIL_IMAP_HOST`, `EMAIL_SMTP_HOST` (y las que falten en `env.ts`, ver abajo) | Fase 2; no dejar credenciales falsas si el canal está desactivado. |
| Adjuntos | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | En Vercel: Cloudflare R2 / S3 / Supabase Storage. MinIO de `docker-compose.yml` **no está disponible** en Vercel; `S3_ENDPOINT=http://localhost:9000` debe cambiar. |
| Webhooks salientes | `OUTBOUND_WEBHOOK_URL`, `OUTBOUND_WEBHOOK_SECRET` | Opcional; vacío desactiva los webhooks a n8n. |
| Modo | `NODE_ENV=production`, `LOG_LEVEL=info` | `NODE_ENV` lo fija Vercel; no hace falta definirlo. |

Aplicar variables a **Production** y, si se quiere probar, a **Preview**. Los cambios de `CRON_SECRET` solo se capturan al **redeployar** (ver `docs/investigacion.md`, apartado b).

**Inconsistencia a corregir en código antes de desplegar:** `src/lib/env.ts` no declara `DIRECT_URL`, `EMAIL_IMAP_PORT/USER/PASS`, `EMAIL_SMTP_PORT/USER/PASS` ni `EMAIL_FROM`, aunque `.env.example` sí los trae. Con `z.object(...).parse(process.env)` las claves sobrantes se ignoran silenciosamente: el worker no podrá leerlas desde `env`. Añadirlas al esquema o eliminarlas del `.env.example`.

## 4. `vercel.json` revisado

Archivo actual (ya corregido para Hobby):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": {
    "src/app/api/cron/tick/route.ts": { "maxDuration": 60 }
  },
  "crons": [{ "path": "/api/cron/tick", "schedule": "0 0 * * *" }]
}
```

Notas operativas:

1. **Hobby permite una ejecución diaria.** El cron diario (`0 0 * * *`) despliega sin problema. En Pro puedes cambiarlo a `*/1 * * * *` para drenar la cola cada minuto; en Hobby, complementa con un cron externo si necesitas envíos más rápidos.
2. **`maxDuration: 60` en el cron** da margen a OpenRouter y a Meta. Si el plan lo permite, súbelo a `300`.
3. **`regions: ["iad1"]`** (Washington D.C.) reduce latencia si la BD está en la costa este de EE. UU.; coloca la BD y la función en la misma región.
4. Cron Jobs es funcionalidad **legacy** en 2026 y migrará a *Schedules*. Revisar el panel Schedules tras el deploy.

Ejemplo para Pro (cada minuto):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": {
    "src/app/api/cron/tick/route.ts": { "maxDuration": 300 },
    "src/app/api/**/route.ts": { "maxDuration": 60 }
  },
  "crons": [{ "path": "/api/cron/tick", "schedule": "*/1 * * * *" }]
}
```

## 5. Route handlers que deben existir antes del deploy

| Ruta | Método | Seguridad | Función |
|---|---|---|---|
| `/api/webhooks/telegram` | POST | `X-Telegram-Bot-Api-Secret-Token` | Recibir `message`/`callback_query` |
| `/api/webhooks/whatsapp` | GET, POST | `hub.verify_token` + `X-Hub-Signature-256` | Verificación Meta + mensajes/estados |
| `/api/webhooks/instagram` | GET, POST | `hub.verify_token` + `X-Hub-Signature-256` | Verificación Meta + mensajes |
| `/api/internal/ingest` | POST | `INGEST_TOKEN` | Normalizar y persistir `CanonicalMessage` |
| `/api/approvals/[id]/decide` | POST | JWT de agente + whitelist | Aprobar/rechazar/editar |
| `/api/stream` | GET | JWT | SSE para el inbox |
| `/api/cron/tick` | GET | `Authorization: Bearer $CRON_SECRET` | Expirar, drenar, reconciliar |

En `/api/cron/tick` añadir `export const dynamic = "force-dynamic";` para evitar respuestas cacheadas que no aparecen en logs.

## 6. Limitaciones reales de serverless

- **Sin IMAP IDLE:** no hay conexión permanente. Usar Gmail Pub/Sub o polling acotado; ver `docs/investigacion.md` (h).
- **SSE con reconexión:** la duración de la función incluye el stream (300 s máx. en Hobby). El cliente debe reconectar con `Last-Event-ID` o un cursor y el servidor enviar heartbeats. No dejar un `ReadableStream` abierto indefinidamente.
- **Cron no fiable al 100 %:** entrega *best effort*, sin reintentos automáticos, con posible duplicado. El tick debe ser idempotente y con lock.
- **Cuerpo de petición:** 4,5 MB por defecto (20 MiB en beta con 4 GB de memoria en Pro). Los adjuntos deben ir a S3/R2 y viajar como URL.
- **Conexiones:** pooler obligatorio, `max: 1`, transacciones cortas; `LISTEN/NOTIFY` y locks de sesión no funcionan en modo transaction.
- **Sin sistema de archivos persistente:** los adjuntos van a almacenamiento externo; nada de escribir en disco local.

## 7. Verificación posterior al deploy

1. `curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/cron/tick` → 200 (y segunda llamada → mismo efecto, sin duplicados).
2. Configurar los webhooks en Meta/Telegram con las URLs del apartado 5 y confirmar el GET de verificación de Meta.
3. Enviar un mensaje de prueba por cada canal activo; comprobar que aparece una sola vez en el inbox (dedupe por `externalId`).
4. Aprobar una propuesta y verificar el estado `sent` con `provider_message_id`.
5. Abrir el inbox en escritorio y móvil; confirmar la reconexión SSE tras cortar la red.
6. Revisar Runtime Logs y la pestaña Schedules → Cron Jobs → View Logs.

## 8. Qué cambiaría en un despliegue Docker propio

- `DATABASE_URL` puede ser la conexión directa a un Postgres local (`docker-compose.yml` ya trae `pgvector/pgvector:pg16`) con un pool normal (`max: 10`); `prepare: true` es seguro porque no hay pooler transaction. El contenedor `redis` permite locks distribuidos reales y caché de SSE.
- MinIO ya está en `docker-compose.yml`: `S3_ENDPOINT=http://minio:9000` con `S3_FORCE_PATH_STYLE=true`; crear el bucket `nexo` al arrancar.
- El cron sale de `vercel.json`: usar un cron del sistema, un sidecar o un `setInterval` en un worker. Ya no hay límite de una vez al día ni de 300 s, pero hay que gestionar el lock y la concurrencia uno mismo.
- IMAP IDLE **sí es posible** en Docker: un proceso worker dedicado puede mantener la conexión y renovarla cada <29 min (RFC 2177).
- SSE puede mantenerse abierta más tiempo, pero detrás de un reverse proxy hay que desactivar buffering (Nginx: `proxy_buffering off`) y ajustar timeouts.
- `CRON_SECRET` se sigue usando si el cron llama por HTTP; si es un worker interno, se sustituye por llamadas directas a funciones del núcleo.
- Hace falta un `Dockerfile` (no existe hoy) con `npm ci && npm run build && npm start`, y un reverse proxy TLS para las URLs de webhook.
