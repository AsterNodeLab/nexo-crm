# Runbook de operación diaria de Nexo

Procedimientos para la operación normal y para incidentes. Los comandos están en sintaxis PowerShell (Windows). Sustituye `<...>` por valores reales y **no pegues secretos en tickets ni en logs**.

## 1. Comprobación diaria (5 minutos)

1. Inbox `/inbox`: revisar aprobaciones `pending` próximas a `expiresAt` (TTL por defecto: 30 min) y conversaciones sin respuesta.
2. Canal Telegram: `getWebhookInfo` → `url` correcta y sin `pending_update_count` creciente.
3. Canales Meta: App Dashboard → Webhooks → validar que los últimos POST son `200`.
4. Vercel → Schedules → Cron Jobs → View Logs: última invocación de `/api/cron/tick` con `2xx`.
5. OpenRouter → `GET https://openrouter.ai/api/v1/key` con la key: revisar `limit_remaining`, `usage_daily` y `effective_budget.remaining_usd`.
6. Buscar en logs estados `sending` estancados y `unknown` (ver apartado 4).

## 2. Backups

Hay dos niveles; **no sustituyen** uno al otro.

### Base de datos (automático, proveedor)

- Neon y Supabase conservan backups/PITR según plan; verificar en el panel la ventana de retención contratada y que esté activa. No asumir una retención concreta sin comprobarla en el proveedor.
- Antes de cualquier migración o cambio destructivo, lanzar un backup manual desde el panel.

### Volcado lógico (bajo demanda)

Con la **cadena directa** (nunca la pooled):

```powershell
$env:PGPASSWORD = "<PASSWORD>"
pg_dump --format=custom --no-owner --no-privileges `
  --host <HOST_DIRECTO> --port 5432 --username <USUARIO> --dbname nexo `
  --file "C:\Backup\nexo-$(Get-Date -Format yyyyMMdd-HHmm).dump"
```

Guardar el archivo cifrado y fuera del servidor de la app. Probar el restore **periódicamente** en una base de prueba; un backup no verificado no cuenta.

### Adjuntos

Si están en R2/S3/Supabase Storage, activar versionado o replicación según proveedor; un `pg_dump` no incluye los archivos binarios.

## 3. Restore

**Precaución:** restaurar sobrescribe datos. Hacerlo en una base nueva primero y validar; solo después decidir si se promueve.

```powershell
$env:PGPASSWORD = "<PASSWORD>"
# Restaurar en BD de prueba:
pg_restore --clean --if-exists --no-owner --no-privileges `
  --host <HOST_DIRECTO> --port 5432 --username <USUARIO> --dbname nexo_restore `
  "C:\Backup\nexo-20261126-0900.dump"
```

Tras restaurar:

1. Ejecutar `npm run typecheck` / consultas de integridad (FK, conteo de mensajes por día).
2. Verificar que las credenciales de canal cifradas siguen siendo legibles por la app (la clave de cifrado debe ser la misma que cuando se guardaron).
3. Si se restauró production, **pausar el cron** (`/api/cron/tick`) mientras se valida, para evitar envíos duplicados de filas `queued` ya enviadas.
4. Reponer los webhooks de Meta/Telegram si el `APP_URL` cambió.

## 4. Envío en estado `unknown`

`unknown` significa: el worker intentó el envío, pero **no sabe si el proveedor lo aceptó** (timeout, 5xx, conexión cortada después de enviar). Regla de oro: **nunca reenviar automáticamente**. Un reenvío puede duplicar el mensaje en el teléfono del cliente.

Procedimiento:

1. Identificar la fila: `outbound_message.id`, canal, `idempotency_key`, destinatario, hora intentada.
2. Buscar `provider_message_id` en la fila y en los logs del worker. Si existe, el envío probablemente se aceptó.
3. Consultar el proveedor:
   - **WhatsApp:** webhooks `statuses` por `wamid` (`sent`/`delivered`/`failed`). Meta reintenta los webhooks hasta 7 días y agrupa eventos: deduplicar.
   - **Telegram:** no hay webhook de estado de entrega; `sendMessage` devuelve el `message_id` si se aceptó. Si hay `message_id`, marcar `sent`. Si no, revisar `getUpdates`/historial del chat antes de decidir.
   - **Email:** revisar logs del SMTP y, si aplica, el `Message-ID`; no asumir entrega por aceptación SMTP.
   - **Instagram:** `messages` webhook con `is_echo: true` confirma que el mensaje salió.
4. Si hay confirmación → `sent` con `provider_message_id`.
5. Si hay confirmación explícita de fallo → `failed` (no reenviar; crear una nueva propuesta si procede).
6. Si no hay evidencia → dejar `unknown`, avisar al agente responsable y decidir manualmente. Si se reenvía, **generar una nueva `idempotency_key`** y documentar por qué.
7. Añadir una nota append-only en la auditoría con quién resolvió el caso y qué evidencia se usó.

Prevención: el cron debe tomar filas con `FOR UPDATE SKIP LOCKED` o un lock en Redis, y actualizar el estado a `sending` **antes** de la llamada externa.

## 5. Rotación de secretos

| Secreto | Procedimiento | Consideración |
|---|---|---|
| `CRON_SECRET` | Editar en Vercel → **redeployar** → revisar primer disparo en logs | El valor se captura al construir el deployment; sin redeploy, Vercel sigue enviando el anterior. Un rollback también restaura el secreto anterior. |
| `TELEGRAM_BOT_TOKEN` | @BotFather → `/token` → elegir bot → regenerar; actualizar variable y volver a llamar a `setWebhook` | Cambiar el token invalida el anterior; el webhook sigue apuntando a la misma URL. |
| `TELEGRAM_WEBHOOK_SECRET` | Generar nueva cadena alfanumérica; actualizar variable, `CHANNEL_META.verifyToken` y repetir `setWebhook` con el nuevo `secret_token` | Solo `A-Z a-z 0-9 _ -`, 1-256 caracteres. |
| Meta `verifyToken` | Generar nuevo valor, actualizar variable/config de canal y el campo *Verify token* del App Dashboard | Meta hará un GET de verificación inmediato; los dos valores deben coincidir antes de guardar. |
| Meta `accessToken` | Business Settings → System users → generar nuevo token con los mismos permisos; actualizar variable | Probar un envío de prueba; revocar el token antiguo solo después. |
| Meta App Secret | App Dashboard → Settings → Basic → rotar | Afecta a la validación `X-Hub-Signature-256` de WhatsApp e Instagram: rotarlo sin actualizar la app deja de verificar los webhooks. |
| `OPENROUTER_API_KEY` | OpenRouter → Settings → Keys → crear nueva, actualizar Vercel, revocar la antigua | Usar key con límite de gasto propio además de `AI_MONTHLY_BUDGET_USD`. |
| `JWT_SECRET` | Rotar y forzar cierre de sesiones | Invalidará tokens existentes. |
| `OUTBOUND_WEBHOOK_SECRET` | Rotar en Nexo y en el consumidor n8n de forma coordinada | Ventana corta de incompatibilidad; decidir si se aceptan ambos temporalmente. |
| Credenciales IMAP/SMTP | Cambiar en proveedor y en la config cifrada del canal | Probar lectura y envío; Gmail requiere contraseña de aplicación u OAuth. |

Después de cualquier rotación: redeployar si la variable cambió en Vercel, ejecutar una prueba end-to-end de ese canal y anotarlo en la auditoría.

## 6. Costes de OpenRouter

- Cada respuesta no-streaming trae `usage.cost` (créditos USD) y `usage.prompt_tokens`/`completion_tokens`. Guardar `id`, `model`, tokens y `cost` junto a cada propuesta para poder reconciliar factura.
- `GET /api/v1/generation?id=<gen_id>` recupera coste y tokens de una generación pasada.
- `GET /api/v1/key` muestra `usage_daily`, `usage_weekly`, `usage_monthly`, `limit_remaining` y `effective_budget` —la primera bandera que bloqueará requests—.
- `AI_MONTHLY_BUDGET_USD` (default 10) es un **presupuesto interno aproximado**: el orquestador deja de proponer al superarlo. No sustituye a los límites de OpenRouter (key, workspace, guardrail, in-flight budget).
- Errores de coste típicos: `402` (créditos/presupuesto en vuelo, mirar `error.metadata.limit_source` y `Retry-After`), `403` (presupuesto agotado), `429` (rate limit), `502` (fallo upstream, **no facturado**).
- Modelos económicos verificados el 26 Nov 2026: `openai/gpt-4o-mini` $0,15/M entrada y $0,60/M salida; `google/gemini-2.5-flash-lite` desde $0,05/M entrada y $0,20/M salida. Los precios cambian: consultar https://openrouter.ai/models antes de cambiar `OPENROUTER_MODEL`.
- `AI_MAX_TOKENS=600` limita la salida por propuesta; bajarlo reduce coste y riesgo de respuestas largas. Los embeddings son deterministas y baratos: guardarlos en BD en vez de recalcularlos.
- WhatsApp tiene coste propio de Meta: desde el 1 de octubre de 2026 se cobran los mensajes de servicio y las plantillas utility dentro de la ventana de 24 h (ver `docs/investigacion.md`, f). Ese coste es **adicional** a OpenRouter.

## 7. Escalado y contactos

- Si fallan todos los canales a la vez: revisar primero la BD (pooler, `DATABASE_URL`), luego Vercel Runtime Logs y por último cada proveedor externo.
- Si un webhook de Meta devuelve 403: comprobar App Secret y la firma HMAC; Meta reintenta hasta 7 días, así que los eventos pueden llegar tarde.
- Si el cron deja de correr en Hobby: revisar Schedules → Cron Jobs y la expresión; una expression más frecuente que diaria no despliega en Hobby.
- Registrar cada incidencia en la tabla de auditoría append-only con hora, impacto y acción correctiva.
