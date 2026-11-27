# Configuración de canales en `/canales`

La pantalla `/canales` se alimenta de `CHANNEL_META` en `src/lib/contracts.ts:25`. **Los nombres de campo de este documento son exactamente las `key` de ese archivo**; si se renombra una key allí, hay que actualizar la pantalla, los adapters y esta guía a la vez.

> **Estado del repo:** la pantalla `/canales` y los route handlers `/api/webhooks/*` todavía no están implementados.Esta guía describe el flujo que debe seguir el usuario cuando existan. Las URLs completas se construyen con `APP_URL` (en Vercel, `https://<dominio>/api/webhooks/...`).

## Antes de empezar

- Genera secretos largos y aleatorios para `verifyToken` (Telegram/Meta) y para `OUTBOUND_WEBHOOK_SECRET`. Un UUID o 32 caracteres alfanuméricos sirven.
- En Telegram, el `secret_token` solo admite `A-Z`, `a-z`, `0-9`, `_` y `-` (1-256 caracteres): **no uses guiones medios, espacios ni símbolos**.
- Los campos marcados como `secret: true` se guardan cifrados y se muestran enmascarados: `botToken`, `verifyToken` (Telegram), `imapPass`, `accessToken` (WhatsApp), `appSecret`, `accessToken` e `verifyToken` (Instagram).

---

## 1. Chat web

No requiere credenciales externas ni webhook.

1. Abre `/canales` → **Chat web** y activa el canal.
2. `allowedOrigins`: escribe los dominios que pueden cargar el widget, separados por coma (p. ej. `https://toplearning.academy,https://www.toplearning.academy`). Dejar vacío permite todos en desarrollo; **en producción, rellénalo**.
3. `widgetTitle`: texto que ve el visitante al abrir el chat, p. ej. `¿En qué podemos ayudarte?`.
4. Copia el snippet del widget desde la propia pantalla y pégalo en el `<body>` de tu sitio. El script apunta a la API pública de Nexo con `INGEST_TOKEN` **nunca** incluido en el navegador: el widget debe enviar a un endpoint propio que haga de puente.

| Campo | Dónde se obtiene |
|---|---|
| `allowedOrigins` | Lo decide el usuario (dominios propios) |
| `widgetTitle` | Lo decide el usuario |

---

## 2. Telegram

1. En Telegram, abre **@BotFather** y envía `/newbot`. Elige nombre y username. BotFather devuelve el token con forma `123456:ABC...` → pégalo en `botToken`.
2. Genera una cadena aleatoria para `verifyToken` (será el `secret_token` de `setWebhook`). Guárdala también en la variable de entorno `TELEGRAM_WEBHOOK_SECRET`.
3. Consigue tu chat ID: escribe al bot y lee `message.chat.id` en el update (o `callback_query.from.id`), o usa un bot consulta-ID como `@userinfobot`. **BotFather no entrega el chat ID.** Pega los IDs permitidos en `approverChatIds`, separados por coma. Solo esos chats podrán aprobar envíos.
4. Registra el webhook. Sustituye `<TOKEN>` y `<SECRETO>` (la misma cadena del paso 2):

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://TU-DOMINIO/api/webhooks/telegram",
    "secret_token": "<SECRETO>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

5. Verifica con `getWebhookInfo` que `url` y `has_custom_certificate` son correctos. `setWebhook` desactiva `getUpdates`: no intentes usar long polling a la vez.
6. Prueba: envía un mensaje al bot; debe aparecer en el inbox. La propuesta de la IA llega al chat con un teclado inline (Aprobar / Rechazar / Editar). Al pulsar, Nexo debe llamar a `answerCallbackQuery` para quitar la barra de progreso.

**URL que copiar en Telegram:** `https://TU-DOMINIO/api/webhooks/telegram`

| Campo | Dónde se obtiene |
|---|---|
| `botToken` | @BotFather → `/newbot` (o `/token` para regenerar) |
| `approverChatIds` | `chat.id` del update o `@userinfobot` |
| `verifyToken` | Lo genera el usuario; debe coincidir con `secret_token` de `setWebhook` |

---

## 3. Correo

**Fase 2 / limitación real:** IMAP IDLE exige una conexión TCP permanente y no funciona en Vercel Functions (ver `docs/investigacion.md`, apartado h). Para Gmail Workspace, el diseño previsto es Gmail Pub/Sub; para IMAP genérico, polling corto o un worker propio en Docker. Los campos actuales solo cubren IMAP/SMTP.

1. Obtén credenciales del buzón. En Gmail, usa una **contraseña de aplicación** (cuenta con 2FA) o, mejor, OAuth vía Pub/Sub. En otros proveedores, usa la contraseña del buzón.
2. Completa en `/canales`:
   - `imapHost`: servidor de entrada, p. ej. `imap.tudominio.com` o `imap.gmail.com`.
   - `imapUser`: cuenta completa, p. ej. `soporte@tudominio.com`.
   - `imapPass`: contraseña de aplicación (cifrada).
   - `smtpHost`: servidor de salida, p. ej. `smtp.tudominio.com` o `smtp.gmail.com`.
   - `fromAddress`: remitente, p. ej. `Nexo <soporte@tudominio.com>`, con SPF, DKIM y DMARC configurados en el DNS del dominio.
3. Configura los mismos valores en `.env.local` / Vercel si el worker los lee de entorno (ver apartado de inconsistencias al final).

| Campo | Dónde se obtiene |
|---|---|
| `imapHost`, `smtpHost` | Documentación del proveedor de correo |
| `imapUser`, `imapPass` | Proveedor / contraseña de aplicación de Gmail |
| `fromAddress` | Lo decide el usuario; verificar DNS (SPF/DKIM/DMARC) |

---

## 4. WhatsApp Business (Cloud API)

1. Crea una app en el **Meta App Dashboard** (https://developers.facebook.com/apps) con el caso de uso *Connect with customers through WhatsApp*.
2. En **App Dashboard → WhatsApp → Configuration** (o *Use cases → Customize → Configuration*), copia la **Callback URL** y el **Verify token**:
   - Callback URL: `https://TU-DOMINIO/api/webhooks/whatsapp`
   - Verify token: una cadena aleatoria que tú elijas → pégala en `verifyToken`.
   - Suscribe el campo `messages`. Meta hará un GET de verificación y debe recibir `200` con `hub.challenge`.
3. En **API Setup** (o Business Manager → Accounts → WhatsApp accounts / Messaging accounts) copia:
   - `phoneNumberId`: ID del número de teléfono business; aparece en el panel de API Setup y en el webhook (`metadata.phone_number_id`).
   - `businessAccountId`: ID de la cuenta de WhatsApp Business / Messaging account; aparece en API Setup como *Messaging account ID* y en el webhook (`entry[].id`).
4. Para producción, crea un **System User** en Business Settings → System users, asígnale el app y la cuenta con *Full control* y genera un token con `business_management`, `whatsapp_business_messaging` y `whatsapp_business_management`. Pégalo en `accessToken`. El token temporal del panel de API Setup caduca en horas: **no usarlo en producción**.
5. Nexo validará cada POST con `X-Hub-Signature-256` (HMAC-SHA256 del body con el **App Secret**). Ese dato hoy no tiene campo en `CHANNEL_META.whatsapp`: debe añadirse o tomarse de una variable de entorno de App Secret (ver inconsistencias).
6. Respeta la ventana de 24 h: fuera de ella, el worker debe usar **plantillas aprobadas**, no texto libre. Las plantillas se crean y aprueban en WhatsApp Manager → Message templates.

**URL que copiar en Meta:** `https://TU-DOMINIO/api/webhooks/whatsapp`

| Campo | Dónde se obtiene |
|---|---|
| `phoneNumberId` | Meta App Dashboard → WhatsApp → API Setup / webhook `metadata.phone_number_id` |
| `businessAccountId` | API Setup (*Messaging account ID*) / Business Manager → WhatsApp accounts / webhook `entry[].id` |
| `accessToken` | System User token con los 3 permisos indicados |
| `verifyToken` | Lo elige el usuario; debe coincidir con el *Verify token* de Meta |

---

## 5. Instagram DM

1. La cuenta de Instagram debe ser **Business/Creator (Professional)** y estar vinculada a una **Page de Facebook**.
2. En App Dashboard → Settings → Basic copia el **App ID** (`appId`) y el **App Secret** (`appSecret`). El App Secret es la clave de `X-Hub-Signature-256`.
3. Genera un token de página con `instagram_basic`, `instagram_manage_messages` y `pages_manage_metadata` (según configuración, también `pages_read_engagement` y `pages_show_list`; con Unified Login, `instagram_manage_messages`). Pégalo en `accessToken`.
4. En App Dashboard → Webhooks, añade la **Callback URL** `https://TU-DOMINIO/api/webhooks/instagram` y el mismo `verifyToken`. Suscribe el objeto `instagram` y el campo `messages`. La app debe estar **publicada**; para datos de usuarios sin rol en la app hace falta App Review aprobado.
5. El Page ID está en Page Settings → About; el IGID (ID de la cuenta profesional) aparece como `entry[].id` del webhook. Ignora los mensajes con `is_echo: true`.

**URL que copiar en Meta:** `https://TU-DOMINIO/api/webhooks/instagram`

| Campo | Dónde se obtiene |
|---|---|
| `appId` | App Dashboard → Settings → Basic |
| `appSecret` | App Dashboard → Settings → Basic (clave HMAC) |
| `accessToken` | Graph API / Facebook Login con permisos de mensajería |
| `verifyToken` | Lo elige el usuario; debe coincidir con el *Verify token* de Meta |

---

## Qué pasa si falta cada dato

| Canal | Campo que falta | Consecuencia concreta |
|---|---|---|
| Web | `allowedOrigins` | En producción, cualquier origen podría cargar el widget (riesgo de abuso). En desarrollo se permite todo. |
| Web | `widgetTitle` | El widget se muestra sin encabezado; no bloquea el chat. |
| Telegram | `botToken` | El adapter no puede llamar a la Bot API: no se registra webhook ni se envían aprobaciones. |
| Telegram | `approverChatIds` | Whitelist vacía: **nadie puede aprobar**; las propuestas quedan `pending` hasta expirar. |
| Telegram | `verifyToken` | No se puede validar `X-Telegram-Bot-Api-Secret-Token`: el webhook queda abierto a solicitudes falsas o se rechazan las legítimas. |
| Email | `imapHost` / `imapUser` / `imapPass` | No hay lectura del buzón; no entran correos al inbox. |
| Email | `smtpHost` / `fromAddress` | No hay salida de correo; las respuestas aprobadas quedan en la cola. Sin SPF/DKIM/DMARC, alta probabilidad de spam o rechazo. |
| WhatsApp | `phoneNumberId` | No se puede construir `POST /<PHONE_NUMBER_ID>/messages`: ningún envío llega. |
| WhatsApp | `businessAccountId` | No se puede asociar la cuenta al webhook ni resolver la facturación/identidad del negocio. |
| WhatsApp | `accessToken` | La API de Graph devuelve 401; no se envía ni se pueden aprobar plantillas. |
| WhatsApp | `verifyToken` | Meta rechaza la configuración del webhook (GET de verificación no devuelve el `hub.challenge`). |
| WhatsApp | `appSecret` | No se puede verificar `X-Hub-Signature-256`: imposible distinguir un POST legítimo de uno falso. |
| Instagram | `appId` | No se identifica la app ante Graph API ni en la configuración de webhooks. |
| Instagram | `appSecret` | No se puede verificar la firma HMAC de los POST. |
| Instagram | `accessToken` | No se pueden leer mensajes ni responder; Graph devuelve error de permiso/token. |
| Instagram | `verifyToken` | Meta no guarda la Callback URL porque la verificación GET falla. |

## Correspondencia entre `CHANNEL_META`, `.env.example` y `env.ts`

- Las variables de email (`EMAIL_IMAP_PORT`, `EMAIL_IMAP_USER`, `EMAIL_IMAP_PASS`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASS`, `EMAIL_FROM`) ya están declaradas en `src/lib/env.ts`.
- `CHANNEL_META.email` usa las keys `imapHost`, `imapUser`, `imapPass`, `smtpHost` y `fromAddress`. Son la configuración cifrada del canal en la base de datos; el adapter de email (fase 2) las lee desde ahí, no desde las variables de entorno. Las variables `EMAIL_*` son el valor por defecto cuando aún no se ha configurado el canal.
- `CHANNEL_META.whatsapp` incluye `appSecret` para verificar `X-Hub-Signature-256`.
- `WHATSAPP_API_VERSION` e `INSTAGRAM_API_VERSION` están en `v23.0` (los ejemplos oficiales usan `v23.0`/`v27.0`).
- El texto de ayuda de Instagram pide `instagram_manage_messages` y `pages_manage_metadata`. Si vas a pedir permisos en App Review, confirma el conjunto exacto según el tipo de app (ver `docs/investigacion.md`).
