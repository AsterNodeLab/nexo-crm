# Nexo · CRM conversacional propio

**Un solo inbox para todas tus conversaciones.** Proyecto construido desde cero, sin Chatwoot ni ningún helpdesk de terceros. Tienes el código, la base de datos y los secretos.

> Estado: MVP funcional en construcción. Web + Telegram están listos; email, WhatsApp e Instagram tienen sus adapters y su apartado de configuración, con las limitaciones documentadas en `docs/canales.md`.

---

## Qué es

- **Inbox único**: conversaciones de todos los canales en una misma vista.
- **CRM de conversación**: contactos, notas, atributos personalizados, etapas, etiquetas y prioridades.
- **IA supervisada**: OpenRouter propone respuestas con citas de tu centro de ayuda. **Nunca envía nada sin aprobación humana** (botón en Telegram o en el dashboard).
- **Motor de reglas propio**: enrutado, etiquetado, avisos SLA. n8n es opcional: recibe webhooks firmados, pero el núcleo no depende de él.
- **Tu marca**: widget embebible y panel de configuración de canales con todos los IDs/tokens.

### Principio de seguridad central

El proceso que habla con el modelo de IA **no tiene credenciales de envío**. Solo escribe una fila `approval` en estado `pending`. El `dispatcher` es el único que puede publicar, y solo lo hace después de una aprobación válida, con idempotencia y registro de auditoría. Un *prompt injection* no tiene conducto de salida.

---

## Arrancar en local

Necesitas Node 24, npm y Docker (o Docker Desktop + WSL2 en Windows).

```bash
cp .env.example .env.local
docker compose up -d
npm install
npm run db:push
npm run dev
```

La primera vez, inicializa los datos de ejemplo con:

```bash
curl -X POST http://localhost:3000/api/auth/bootstrap
```

Abre `http://localhost:3000/inbox`. Usuario inicial: `owner@nexo.local` / contraseña definida en `SEED_OWNER_PASSWORD` (por defecto `nexo123`). **Cámbiala antes de exponer la app.**

Comandos útiles:

```bash
npm run typecheck
npm test
npm run build
```

---

## Configurar los canales

Entra en **Canales** (`/canales`). Hay una tarjeta por canal con todos sus campos (IDs y tokens) y la URL exacta del webhook que debes pegar en Telegram o Meta. Los secretos se cifran AES-256-GCM en PostgreSQL y **nunca se devuelven al navegador**: se muestran como `••••••`.

Guía paso a paso y de dónde sacar cada ID: `docs/canales.md`.

| Canal | Estado | Webhook |
|---|---|---|
| Web widget | Listo | — (script en `public/widget.js`) |
| Telegram | Listo | `/api/webhooks/telegram` |
| WhatsApp Cloud | Adapter listo, requiere verificación de Meta | `/api/webhooks/whatsapp` |
| Instagram DM | Adapter listo, requiere app de Meta | `/api/webhooks/instagram` |
| Email | Fase 2 (IMAP IDLE no funciona en serverless) | — |

Para incrustar el widget:

```html
<script src="https://TU-DOMINIO/widget.js"
        data-nexo-url="https://TU-DOMINIO"
        data-nexo-visitor-id="alumno-123"
        data-nexo-title="¿En qué podemos ayudarte?"></script>
```

---

## Arquitectura

```text
Cliente → webhook / widget → adapter (verifica firma) → POST /api/internal/ingest
        → event + message (dedupe) → motor de conversación + CRM
        → reglas → IA (OpenRouter) → approval=pending
        → aprobación humana → outbound_message=approved
        → dispatcher (ÚNICO con credenciales) → Telegram / Meta / SMTP
```

- **Base de datos**: PostgreSQL (pgvector para el centro de ayuda). Drizzle ORM.
- **Colas/timers**: tabla `outbound_message` + `/api/cron/tick` cada minuto. Sin Redis obligatorio en Vercel.
- **Adjuntos**: S3-compatible (MinIO en local, R2/S3 en Vercel).
- **Eventos en caliente**: SSE en `/api/stream`, con polling como fallback en la UI.
- **Auditoría**: `ai_audit` y `audit_log` son append-only.

Documentación completa: `docs/arquitectura.md`, `docs/investigacion.md`, `docs/runbook.md`.

---

## Desplegar en Vercel

```bash
npm i -g vercel
vercel link
vercel env pull .env.local
vercel deploy --prod
```

1. Crea un Postgres serverless (Neon o Supabase) y copia `DATABASE_URL` y `DIRECT_URL`.
2. Configura TODAS las variables de `.env.example` en Vercel (`vercel env add NOMBRE`).
3. Ejecuta las migraciones una vez: `npm run db:push` apuntando a la BD de producción.
4. Cambia `JWT_SECRET`, `INGEST_TOKEN`, `CRON_SECRET` y los secrets de Meta. **Nunca dejes los valores de ejemplo.**
5. `vercel.json` ya trae un cron diario (`0 0 * * *`) hacia `/api/cron/tick`, compatible con Hobby.

Limitaciones reales de serverless (no son bugs del proyecto): sin IMAP IDLE persistente, SSE por instancia (por eso hay polling), y en el plan Hobby los cron son diarios — usa Pro o un cron externo si necesitas cada minuto. Detalles en `docs/despliegue-vercel.md`.

---

## Roadmap

**Hecho en el MVP:** inbox único, contactos, aprobaciones, configuración de canales, widget, IA con citas, reglas, dispatcher, cron, auth, SSE.

**Siguiente:** email IMAP/SMTP con hilos y rebotes, centro de ayuda público, CSAT, reportes avanzados, exportación.

**Fuera de alcance a propósito:** multi-tenant, facturación, voz, TikTok/LINE/SMS, app móvil nativa, réplica de las funciones "monitores/content gap/escenarios" de otros productos.

---

## Notas de seguridad

- `drizzle-orm` y `zod` están en versiones parcheadas (sin los avisos de inyección SQL / agotamiento de memoria).
- Queda un aviso de `npm audit` sobre el `postcss` que empaqueta Next 15. Afecta al procesamiento de CSS con `sourceMappingURL` controlado por atacante; en este proyecto el CSS es propio. Subir a Next 16 lo resuelve, pero Next 16 rompe el prerender de `/canales` en este código, así que se mantuvo Next 15.5.29 a la espera de una corrección upstream.
- Antes de exponer la app: cambia `JWT_SECRET`, `INGEST_TOKEN`, `CRON_SECRET` y la contraseña del owner. Usa HTTPS siempre.

## Licencia

Código propio. Sin dependencias de productos de terceros para el núcleo. Las librerías usadas tienen sus propias licencias (MIT/Apache según cada una).
