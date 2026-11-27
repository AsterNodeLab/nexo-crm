# Investigación técnica de Nexo (verificada el 26 de noviembre de 2026)

Este documento recoge datos comprobados contra documentación oficial y sus URLs. Cuando un dato no pudo verificarse se dice explícitamente. Es la base de las decisiones de arquitectura, canales, despliegue y operación.

## (a) Next.js App Router: route handlers y streaming/SSE

- Los **Route Handlers** viven solo en `app/**/route.ts`, usan las APIs Web `Request`/`Response` (o `NextRequest`/`NextResponse`) y son **endpoints HTTP públicos**. Métodos soportados: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`; un método no soportado devuelve `405`. Sirven también para webhooks de terceros.
  Fuentes: https://nextjs.org/docs/app/getting-started/route-handlers y https://nextjs.org/docs/app/guides/backend-for-frontend
- El **streaming en route handlers** se hace con la Web Streams API: `new ReadableStream({ start(controller) { ... } })`, `TextEncoder` y `new Response(stream, { headers })`. El ejemplo oficial usa `Content-Type: text/plain; charset=utf-8` y `X-Content-Type-Options: nosniff`.
  Fuente: https://nextjs.org/docs/app/guides/streaming#streaming-in-route-handlers y https://nextjs.org/docs/app/api-reference/file-conventions/route#streaming
- **SSE** (Server-Sent Events) es un formato de stream: líneas `data: ...` separadas por líneas en blanco y `data: [DONE]` como centinela habitual en APIs de IA; el cliente debe reconectar cuando se corta la conexión. Next.js no añade magia: el handler debe emitir `Content-Type: text/event-stream` y gestionar el cierre. OpenRouter confirma que sus streams son SSE y que pueden incluir líneas de comentario que hay que ignorar.
  Fuentes: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format y https://openrouter.ai/docs/api-reference/overview
- **Implicación para Nexo:** los eventos de `SSE_EVENTS` en `src/lib/contracts.ts` (`message.created`, `conversation.updated`, `approval.created`, `approval.decided`) se emitirán desde un route handler. En Vercel la duración de la función **incluye** el tiempo con la respuesta abierta y streams, así que una SSE infinita no es sostenible: el cliente debe reconectar y el handler debe cerrar por tiempo/heartbeat.
  Fuente: https://vercel.com/docs/functions/limitations#max-duration

## (b) Vercel Cron: límites reales y `/api/cron/tick`

Fuente principal: https://vercel.com/docs/cron-jobs/usage-and-pricing y https://vercel.com/docs/cron-jobs/manage-cron-jobs (la documentación indica que Cron Jobs es una función **legacy** que migrará a *Schedules*; los hechos siguientes corresponden a la documentación consultada en noviembre de 2026).

| Plan | Cron jobs por proyecto | Intervalo mínimo | Precisión |
|---|---|---|---|
| Hobby | 100 | **una vez al día** | por hora (±59 min) |
| Pro | 100 | una vez por minuto | por minuto |
| Enterprise | 100 | una vez por minuto | por minuto |

- Los cron jobs están disponibles en **todos los planes** y no tienen cargo propio, pero consumen invocaciones/recursos de Vercel Functions.
- En Hobby, expresiones como `* * * * *` o `0 * * * *` **fallan en el despliegue** con el error «Hobby accounts are limited to daily cron jobs». Una expresión `0 8 * * *` puede dispararse en cualquier momento entre 08:00 y 08:59.
- Vercel hace una petición **GET** a la URL de producción, con `User-Agent: vercel-cron/1.0` y la cabecera `x-vercel-cron-schedule`. La zona horaria es **UTC**; no se admiten alias (`MON`, `SUN`, `JAN`); no se pueden fijar a la vez día del mes y día de la semana.
- **Seguridad:** si existe la variable de entorno `CRON_SECRET`, Vercel la envía automáticamente como `Authorization: Bearer <CRON_SECRET>`. El handler debe comparar exactamente esa cabecera y devolver `401` si no coincide. El secreto se captura **al construir el deployment**: cambiar la variable no surte efecto hasta redeployar. Para rotarlo: editar → redeploy → revisar logs del primer disparo.
- Vercel **no reintenta** un cron fallido; la entrega es *best effort* (puede faltar una ejecución o duplicarse una). Por eso `/api/cron/tick` debe ser **idempotente** y reconciliar todo el trabajo pendiente desde la última ejecución correcta, con un lock para evitar solapamientos.
- Los cron jobs no siguen redirecciones (3xx) y solo corren en deployments de producción. Si el endpoint cached/redirige, puede no aparecer en logs; añadir `export const dynamic = "force-dynamic";`.

**Estado actual:** `vercel.json` usa `"schedule": "0 0 * * *"` (diario, compatible con Hobby) y `maxDuration: 60` en `/api/cron/tick`. En Pro se puede cambiar a cada minuto. Con cron diario, la expiración de propuestas y el drenaje de la cola no pueden depender solo de Vercel Cron en Hobby.

## (c) Postgres serverless en Vercel: Neon/Supabase, `postgres.js` y Drizzle

- **Vercel Postgres ya no está disponible**: la documentación oficial indica que las bases antiguas se migraron automáticamente a Neon en diciembre de 2024 y que los proyectos nuevos deben instalar un proveedor Postgres del Marketplace (Neon, Supabase, Prisma Postgres, AWS Aurora, etc.). Las credenciales se inyectan como variables de entorno.
  Fuente: https://vercel.com/docs/postgres
- **Neon** usa PgBouncer en modo *transaction*: acepta hasta 10.000 conexiones de cliente; el hostname agrupado termina en `-pooler`. La cadena **pooled** es la correcta para funciones serverless; la **directa** se reserva para migraciones, `pg_dump`/`pg_restore`, `LISTEN/NOTIFY`, `SET` de sesión y `CREATE INDEX CONCURRENTLY`. En modo transaction no funcionan `SET`, `PREPARE` SQL, tablas temporales con `PRESERVE`, locks de sesión ni `LISTEN/NOTIFY`.
  Fuente: https://neon.com/docs/connect/connection-pooling (actualizado el 26 de noviembre de 2026)
- **Supabase** ofrece el *shared pooler* en modo transaction (puerto `6543`) para serverless/edge y la conexión directa para migraciones y backups. Su guía recomienda, para serverless: crear el cliente una vez a nivel de módulo, `max: 1`, `prepare: false` y `ssl: "require"` con `postgres.js`; advierte que el pool por defecto de `postgres.js` es 10 conexiones por instancia caliente y que el modo transaction no soporta prepared statements ni pipelining. Para Drizzle/postgres.js el ajuste es `prepare: false`.
  Fuente: https://supabase.com/docs/guides/database/connecting-to-postgres
- **Por qué `postgres.js` + Drizzle funcionan:** Drizzle ORM tiene soporte nativo para `postgres.js` mediante `drizzle-orm/postgres-js` (`drizzle({ client: sql })`); la propia documentación advierte que `postgres.js` usa prepared statements por defecto y que puede haber que desactivarlos. El orden de importancia es: cadena pooled en `DATABASE_URL`, cadena directa en `DIRECT_URL` para migraciones, `max: 1` y `prepare: false` con pooler en modo transaction. `postgres.js` usa prepared statements **a nivel de protocolo**, que Neon sí admite, pero el pooler compartido de Supabase en transaction mode no; por eso `prepare: false` es la opción segura y portable.
  Fuentes: https://supabase.com/docs/guides/database/postgres-js y https://orm.drizzle.team/docs/get-started-postgresql
- **Límites Vercel Functions** que afectan a la BD: memoria máx. 2 GB en Hobby / 4 GB en Pro; duración 300 s por defecto (Hobby máx. 300 s; Pro máx. 800 s, 1800 s en beta); cuerpo de petición 4,5 MB por defecto; 1.024 file descriptors compartidos. Usar pooler y transacciones cortas.
  Fuente: https://vercel.com/docs/functions/limitations

**Detectado en el repo:** `.env.example` define `DIRECT_URL`, pero `src/lib/env.ts` no lo declara ni lo valida; `drizzle.config.ts` usa solo `DATABASE_URL`. Si `DATABASE_URL` apunta al `-pooler`, las migraciones pueden fallar por el modo transaction. Además `drizzle.config.ts` apunta a `./src/db/schema.ts`, que todavía no existe en el repo.

## (d) OpenRouter: chat completions, embeddings y costes

Fuente principal: https://openrouter.ai/docs/api-reference/overview

- **Chat Completions:** `POST https://openrouter.ai/api/v1/chat/completions`, cabeceras `Authorization: Bearer <key>`, `Content-Type: application/json`, opcionales `HTTP-Referer` y `X-OpenRouter-Title`. Cuerpo: `model` (con prefijo de proveedor), `messages` (roles `system`/`user`/`assistant`/`tool`), `max_tokens`, `temperature`, `stream`, `response_format`, `tools`, `models`/`route` para fallback, `provider` para enrutamiento, `user`.
- **Respuesta normalizada:** `{ id, object: "chat.completion", created, model, provider, choices: [{ finish_reason, native_finish_reason, message: { role, content, tool_calls? } }], usage: { prompt_tokens, completion_tokens, total_tokens, cost?, cost_details?, prompt_tokens_details?: { cached_tokens } } }`. `choices` es siempre array; con `stream: true` cada chunk trae `delta` en vez de `message` y el **último chunk** lleva `usage` (con `choices` no vacío, a diferencia de OpenAI). `finish_reason` normalizado: `tool_calls`, `stop`, `length`, `content_filter`, `error`.
- **Streaming:** `stream: true` devuelve SSE; hay que ignorar líneas de comentario y detectar `finish_reason: "error"` dentro del stream (un 429 puede llegar como evento SSE después del HTTP 200).
- **Embeddings:** `POST https://openrouter.ai/api/v1/embeddings` con `{ model, input: string | string[], encoding_format? }`; respuesta `{ object: "list", model, data: [{ object: "embedding", index, embedding: number[] }], usage: { prompt_tokens, total_tokens } }`. No soportan streaming. Modelos listables en `GET /api/v1/embeddings/models`. El modelo configurado en el repo, `openai/text-embedding-3-small`, está documentado y devuelve 1536 dimensiones en el ejemplo oficial.
  Fuente: https://openrouter.ai/docs/api-reference/embeddings
- **Modelos económicos verificados** (precios por millón de tokens, variante estándar, consultados el 26 Nov 2026; pueden cambiar):
  - `openai/gpt-4o-mini`: $0,15 entrada / $0,60 salida. https://openrouter.ai/openai/gpt-4o-mini
  - `google/gemini-2.5-flash-lite`: desde $0,05 entrada / $0,20 salida según proveedor. https://openrouter.ai/google/gemini-2.5-flash-lite
  - Para precio actualizado y comparación: https://openrouter.ai/models y https://openrouter.ai/pricing
- **Límites y costes:** `GET /api/v1/key` devuelve `limit_remaining`, `usage_daily/weekly/monthly`, `effective_budget` y `free_model_daily_requests`. Modelos `:free`: 20 req/min y 50 req/día sin créditos comprados; 1000 req/día con al menos 10 créditos. Errores: 400, 401, 402 (créditos/presupuesto en vuelo), 403 (presupuesto), 404, 429, 502 (falló upstream, **no se factura**). Cada respuesta no-streaming trae `usage.cost` en créditos USD; `GET /api/v1/generation?id=<id>` recupera el coste de una generación ya hecha.
  Fuente: https://openrouter.ai/docs/api-reference/limits

## (e) Telegram Bot API: webhook, secreto, teclados y callbacks

- `@BotFather` (`/newbot`) entrega el **token** con forma `123456:ABC...`. Todas las llamadas son HTTPS a `https://api.telegram.org/bot<token>/<METODO>` y devuelven `{ ok, result?, description?, error_code? }`. Los updates se retienen como máximo **24 horas**; `getUpdates` (long polling) y webhook son mutuamente excluyentes.
  Fuente: https://core.telegram.org/bots/api
- **`setWebhook`:** parámetros `url` (HTTPS, obligatoria), `secret_token`, `allowed_updates`, `drop_pending_updates`, `max_connections` (1-100, default 40), `ip_address`, `certificate`. Con `secret_token`, Telegram añade la cabecera **`X-Telegram-Bot-Api-Secret-Token`** a cada POST. El secreto debe tener 1-256 caracteres y solo `A-Z`, `a-z`, `0-9`, `_`, `-`. Respuestas HTTP no-2xx provocan reintentos. Puertos webhook soportados: 443, 80, 88, 8443. Un webhook activo desactiva `getUpdates`.
  Fuente: https://core.telegram.org/bots/api/methods/setwebhook
- **Inline keyboards:** botones adjuntos al mensaje que **no envían texto al chat**; al pulsarlos llega un `CallbackQuery` con `id`, `from`, `message`, `chat_instance` y `data`. Telegram muestra una barra de progreso hasta que el bot llama a `answerCallbackQuery`; hay que responder siempre, aunque sea vacío. Para cambiar el menú sin enviar otro mensaje, usar `editMessageReplyMarkup`.
  Fuentes: https://core.telegram.org/bots/features#inline-keyboards y https://core.telegram.org/bots/api/types/callbackquery
- **Chat ID:** no lo entrega BotFather. Se obtiene del objeto `Chat`/`User` en el primer update (`message.chat.id` / `callback_query.from.id`) o con `getChat`/`getUpdates`. La whitelist debe guardar esos IDs numéricos.
- **Implicación para Nexo:** `/api/webhooks/telegram` debe validar la cabecera secreta antes de parsear, convertir `message` y `callback_query` a `CanonicalMessage`/eventos de aprobación, y responder rápido (el trabajo pesado va a la cola). Con `allowed_updates` conviene pedir `["message", "callback_query"]`.

## (f) WhatsApp Cloud API: verificación, firma, ventana de 24 h y plantillas

- **Verificación del webhook:** Meta envía `GET <callback>?hub.mode=subscribe&hub.challenge=<valor>&hub.verify_token=<token>`. El servidor compara `hub.verify_token` con su valor guardado y responde `200` con `hub.challenge` exacto; cualquier otra respuesta invalida la configuración. Los POST traen `X-Hub-Signature-256: sha256=<HMAC-SHA256>` calculado con el **App Secret** como clave y el cuerpo JSON como mensaje; hay que compararlo en tiempo constante. Los POST se agrupan hasta 1000 eventos (no garantizado), se reintentan hasta 7 días y **hay que deduplicar**.
  Fuente: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
- **Configuración en Meta:** App Dashboard → WhatsApp → Configuration: *Callback URL* y *Verify token*. El panel de *API Setup* muestra el **Messaging account ID** (WABA) y el **phone number ID** de prueba. Para producción se crea un **System User** en Business Settings con permisos `business_management`, `whatsapp_business_messaging` y `whatsapp_business_management`, y se le asignan el app y la cuenta de WhatsApp/Messaging; su token es de larga duración. Los tokens de usuario caducan en horas. Los tokens son cadenas opacas: no parsear ni asumir longitud fija.
  Fuentes: https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started y https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens
- **Envío:** `POST https://graph.facebook.com/<VERSION>/<PHONE_NUMBER_ID>/messages` con `{ messaging_product, recipient_type, to, type, ... }`. La respuesta `{"messages":[{"id":"wamid..."}]}` solo significa **aceptado**, no entregado; la entrega llega como webhook `statuses` (`sent`, `delivered`, `read`, `failed`). Se recomienda `to` con `+` y código de país; también se puede usar `recipient` con un BSUID.
  Fuente: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
- **Ventana de 24 h:** se abre (y se reinicia) cada vez que el usuario escribe o llama. Solo dentro de ella se pueden enviar **mensajes de servicio** (no-template). Fuera de la ventana, solo **plantillas aprobadas**. Desde el 1 de octubre de 2026 Meta cobra por mensaje también los mensajes de servicio y las plantillas utility enviadas dentro de la ventana; conviene revisar la tarifa vigente antes de dimensionar costes.
  Fuentes: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#customer-service-windows y https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- **Plantillas:** categorías marketing / utility / authentication; requieren aprobación de Meta. https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview

**Estado actual:** `WHATSAPP_API_VERSION=v23.0` y `INSTAGRAM_API_VERSION=v23.0` en `.env.example`, y `CHANNEL_META.whatsapp` incluye `appSecret` para validar `X-Hub-Signature-256`. Los ejemplos oficiales consultados usan `v23.0`/`v27.0`; revisa el changelog de Graph API antes de subir de versión.

## (g) Instagram Graph API: webhooks y permisos

- Los webhooks de Instagram Messaging requieren una cuenta **Professional** vinculada a una Page de Facebook, app publicada y permisos. La configuración clásica (Messenger Platform) exige `instagram_basic`, `instagram_manage_messages` y `pages_manage_metadata`; la tabla oficial también lista `pages_read_engagement` y `pages_show_list` para el campo `messages`. Con *Instagram API with Unified Login* basta `instagram_manage_messages` para `messages` y `messaging_postbacks`. La app debe estar aprobada en App Review para ver datos de personas sin rol en la app.
  Fuentes: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks y https://developers.facebook.com/documentation/instagram-platform/webhooks/fields
- El payload es `{"object":"instagram","entry":[{"id":"<IGID>","time":...,"messaging":[{"sender":{"id":"<IGSID>"},"recipient":{"id":"<IGID>"},"timestamp":...,"message":{"mid":...,"text":...}}]}]}`. Hay que ignorar mensajes con `is_echo: true` (enviados por el propio negocio) y `is_deleted`/`is_unsupported`. Campos:`messages`, `messaging_postbacks`, `messaging_seen`, `messaging_referral`, `message_reactions`, `standby`. Los GIF/stickers no disparan webhook.
  Fuente: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks
- Igual que WhatsApp, la verificación GET usa `hub.verify_token`/`hub.challenge` y los POST traen `X-Hub-Signature-256` con el **App Secret**. La configuración se hace en App Dashboard → Webhooks, suscribiendo el objeto `instagram` y el campo `messages`.
  Fuente: https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
- El `appId` y `appSecret` están en App Dashboard → Settings → Basic; el Page ID en Page Settings → About; el IGID se obtiene vía Graph API (`/me` de la Page) o del propio webhook (`entry[].id`).

**No verificado / a revisar:** el texto de ayuda de `CHANNEL_META.instagram` ya no pide `pages_messaging` (ahora `instagram_manage_messages` y `pages_manage_metadata`), pero la tabla oficial consultada no enumera permisos de forma exhaustiva. La tabla oficial consultada para la configuración clásica no enumera `pages_messaging` (sí `instagram_manage_messages`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`). Históricamente se ha solicitado para suscribir el campo `messages` de la Page; antes de pedirlo en App Review conviene confirmar el conjunto exacto según el tipo de app.

## (h) IMAP IDLE y por qué NO funciona en serverless

- **RFC 2177** (junio 1997) define `IDLE`: el cliente envía `IDLE`, el servidor responde `+ idling`, y la conexión TCP permanece abierta hasta que el cliente envía `DONE`. El propio RFC advierte que el servidor puede desconectar por inactividad y recomienda **renovar IDLE al menos cada 29 minutos**. https://www.rfc-editor.org/rfc/rfc2177
- En un modelo serverless (Vercel Functions) no hay un proceso permanente: la función se crea por petición, se congela/reutiliza y se escala a cero; la duración máxima es de 300 s en Hobby. Mantener un socket IMAP abierto y renovarlo cada 29 minutos requeriría un worker persistente, no un route handler. Además, Postgres en modo pooled no permite `LISTEN/NOTIFY` como mecanismo de señalización de sesión.
  Fuentes: https://vercel.com/docs/functions y https://vercel.com/docs/functions/limitations
- **Alternativa para Gmail:** Gmail API push usa **Cloud Pub/Sub**, no IMAP. Se crea un topic y una suscripción (push HTTP o pull), se concede permiso de publicación a `gmail-api-push@system.gserviceaccount.com`, se llama a `users.watch({ topicName, labelIds: ["INBOX"] })` y se renueva **al menos cada 7 días** (recomendado: diario). La notificación llega como `POST` JSON con `message.data` en Base64URL (`{"emailAddress","historyId"}`); se confirma con HTTP 200 y se consulta `history.list` desde el último `historyId` conocido. Límite: 1 notificación/segundo por usuario; puede haber retrasos o pérdidas, así que hace falta reconciliación periódica.
  Fuente: https://developers.google.com/gmail/api/guides/push
- Para IMAP genérico (no Gmail) en serverless, la alternativa realista es **polling periódico** vía cron con `UID SEARCH`/`UNSEEN` y ventanas cortas, o un worker/daemon propio (Docker) con IDLE. La opción elegida por Nexo para fase 2 debe ser Gmail Pub/Sub cuando el buzón sea Workspace; el formulario actual de correo solo ofrece IMAP/SMTP y no tiene campo para el topic de Pub/Sub.
