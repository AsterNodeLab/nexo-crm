"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, Bot, Clock3, Gauge, LockKeyhole, ShieldCheck, Wallet } from "lucide-react";
import type { ChannelView, StatsView } from "@/lib/contracts";
import { AppShell } from "@/components/AppShell";
import { fetchApi } from "@/components/api";
import { Badge, ErrorBanner, LoadingState, PageHeader } from "@/components/ui";

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SettingItem({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Bot;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="surface-2 flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-muted" aria-hidden="true">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{description}</p>
        <div className="mt-2.5">{children}</div>
      </div>
    </div>
  );
}

export default function AjustesPage() {
  const [stats, setStats] = useState<StatsView | null>(null);
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchApi<StatsView>("/api/stats"), fetchApi<ChannelView[]>("/api/channels")])
      .then(([nextStats, nextChannels]) => {
        if (!active) return;
        setStats(nextStats);
        setChannels(nextChannels);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (active) setError(messageFrom(loadError, "No se pudo cargar el estado del sistema."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const approversField = channels
    .find((channel) => channel.type === "telegram")
    ?.fields.find((field) => field.key === "approverChatIds");
  const approvers = (approversField?.value ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Preferencias"
        title="Ajustes"
        description="Parámetros del motor, aprobadores y estado del sistema. Los cambios sensibles se hacen en el servidor."
      >
        <Badge tone="success" className="!px-3 !py-1.5 !text-xs">
          <span className="size-2 rounded-full bg-current" aria-hidden="true" />
          Sistema activo
        </Badge>
      </PageHeader>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingState label="Cargando ajustes…" /> : null}

      {!loading ? (
        <div className="space-y-10">
          <section aria-labelledby="titulo-ia">
            <p className="eyebrow">Inteligencia artificial</p>
            <h2 id="titulo-ia" className="mt-2 text-xl font-semibold text-text">
              Motor de propuestas
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Estos valores son de solo lectura. Se definen en el archivo <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text">.env</code> del
              servidor y requieren reiniciar la aplicación.
            </p>
            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              <SettingItem
                icon={Bot}
                title="Modelo"
                description="Modelo de OpenRouter que redacta las respuestas propuestas."
              >
                <code className="rounded bg-surface-3 px-2 py-1 font-mono text-xs text-text">OPENROUTER_MODEL</code>
              </SettingItem>
              <SettingItem
                icon={Wallet}
                title="Presupuesto mensual"
                description="Límite de gasto en USD. Al alcanzarse, el motor deja de proponer respuestas."
              >
                <code className="rounded bg-surface-3 px-2 py-1 font-mono text-xs text-text">AI_MONTHLY_BUDGET_USD</code>
              </SettingItem>
              <SettingItem
                icon={Clock3}
                title="TTL de propuestas"
                description="Minutos que una aprobación permanece vigente antes de expirar."
              >
                <code className="rounded bg-surface-3 px-2 py-1 font-mono text-xs text-text">AI_PROPOSAL_TTL_MINUTES</code>
              </SettingItem>
            </div>
          </section>

          <section aria-labelledby="titulo-aprobadores">
            <p className="eyebrow">Human in the loop</p>
            <h2 id="titulo-aprobadores" className="mt-2 text-xl font-semibold text-text">
              Aprobadores de Telegram
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Solo estos chats pueden aprobar o rechazar respuestas desde el bot. Se editan en Canales → Telegram.
            </p>
            <div className="surface mt-5 p-5">
              {approvers.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <ShieldCheck size={18} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
                  <p className="text-sm text-muted">Sin aprobadores configurados.</p>
                  <Link href="/canales" className="text-sm font-medium text-accent hover:underline">
                    Configurar Telegram
                  </Link>
                </div>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {approvers.map((id) => (
                    <li key={id} className="rounded-lg bg-surface-3 px-2.5 py-1.5 font-mono text-xs text-text">
                      {id}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section aria-labelledby="titulo-integraciones">
            <p className="eyebrow">Integraciones</p>
            <h2 id="titulo-integraciones" className="mt-2 text-xl font-semibold text-text">
              Webhook saliente
            </h2>
            <div className="mt-5 space-y-3">
              <div className="surface-2 p-4">
                <div className="flex items-center gap-2">
                  <LockKeyhole size={16} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-text">n8n</h3>
                </div>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-muted">
                  n8n es opcional; el motor de reglas propio funciona sin él. La URL de destino se define en el servidor
                  con <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text">OUTBOUND_WEBHOOK_URL</code> y su firma con{" "}
                  <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text">OUTBOUND_WEBHOOK_SECRET</code>.
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="titulo-estado">
            <p className="eyebrow">Diagnóstico</p>
            <h2 id="titulo-estado" className="mt-2 text-xl font-semibold text-text">
              Estado del sistema
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="surface-2 p-4">
                <p className="text-xs text-muted">Conversaciones abiertas</p>
                <p className="tabular mt-1 font-display text-2xl font-semibold text-text">{stats?.open ?? "—"}</p>
              </div>
              <div className="surface-2 p-4">
                <p className="text-xs text-muted">Pendientes</p>
                <p className="tabular mt-1 font-display text-2xl font-semibold text-text">{stats?.pending ?? "—"}</p>
              </div>
              <div className="surface-2 p-4">
                <p className="text-xs text-muted">Mensajes hoy</p>
                <p className="tabular mt-1 font-display text-2xl font-semibold text-text">{stats?.messagesToday ?? "—"}</p>
              </div>
              <div className="surface-2 p-4">
                <p className="text-xs text-muted">Aprobaciones en espera</p>
                <p className="tabular mt-1 font-display text-2xl font-semibold text-text">{stats?.pendingApprovals ?? "—"}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Activity size={14} strokeWidth={1.75} aria-hidden="true" />
                Primera respuesta:{" "}
                <span className="tabular text-text">
                  {stats?.avgFirstResponseMin == null ? "sin datos" : `${stats.avgFirstResponseMin} min`}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Gauge size={14} strokeWidth={1.75} aria-hidden="true" />
                Resueltas: <span className="tabular text-text">{stats?.resolved ?? "—"}</span>
              </span>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
