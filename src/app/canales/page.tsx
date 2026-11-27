"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Info, Radio } from "lucide-react";
import type { ChannelView } from "@/lib/contracts";
import { AppShell } from "@/components/AppShell";
import { fetchApi } from "@/components/api";
import { ChannelCard } from "@/components/channels/ChannelCard";
import { EmptyState, ErrorBanner, LoadingState, PageHeader } from "@/components/ui";

const GUIA = [
  {
    title: "Chat web",
    steps: [
      "Copia el script de public/widget.js en tu sitio y añade los atributos data-nexo-url y data-nexo-visitor-id.",
      "En Orígenes permitidos escribe el dominio desde el que se embedirá el widget.",
      "El título del widget es el texto que verá el visitante al abrir el panel.",
    ],
  },
  {
    title: "Telegram",
    steps: [
      "Crea el bot con @BotFather y pega el token en Bot token.",
      "Registra la URL del webhook en Telegram y usa el mismo valor en Webhook secret.",
      "Añade en Chat IDs con permiso de aprobación el ID de cada persona que podrá aprobar envíos.",
    ],
  },
  {
    title: "Correo",
    steps: [
      "Completa los hosts IMAP y SMTP con los valores de tu proveedor.",
      "Usa una contraseña de aplicación, no la contraseña de la cuenta.",
      "Verifica SPF, DKIM y DMARC en tu dominio para que los mensajes no caigan en spam.",
    ],
  },
  {
    title: "WhatsApp Business",
    steps: [
      "En Meta Business copia el Phone number ID y el Business account ID.",
      "Genera un token de sistema con permisos whatsapp_business_messaging.",
      "Suscribe el webhook de la página al evento messages y usa el mismo Verify token aquí.",
    ],
  },
  {
    title: "Instagram DM",
    steps: [
      "Vincula tu cuenta Business de Instagram a una página de Facebook.",
      "Copia el App ID y genera un Access token con permisos instagram_manage_messages.",
      "Registra la URL del webhook y el Verify token en la configuración de la app.",
    ],
  },
];

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function CanalesPage() {
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchApi<ChannelView[]>("/api/channels");
      setChannels(list);
      setError(null);
    } catch (loadError) {
      setError(messageFrom(loadError, "No se pudieron cargar los canales."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const configured = channels.filter((channel) => channel.enabled).length;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Conexiones"
        title="Canales"
        description="Configura por dónde entra y sale cada conversación. Todo llega al mismo inbox."
      >
        <Link href="#guia" className="btn-secondary">
          <BookOpen size={16} strokeWidth={1.75} aria-hidden="true" />
          Ver guía de configuración
        </Link>
      </PageHeader>

      <div className="surface-2 mb-7 flex items-start gap-3 px-4 py-3.5 text-sm text-muted">
        <Info size={17} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          Pega aquí los IDs y tokens de cada canal. Los secretos se cifran en la base de datos y nunca se devuelven al
          navegador.
        </p>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <LoadingState label="Cargando canales…" />
      ) : channels.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No hay canales disponibles"
          description="Revisa la conexión con el servidor para ver los canales configurables."
        />
      ) : (
        <>
          <p className="eyebrow mb-4">
            {configured} de {channels.length} canales configurados
          </p>
          <div className="grid items-start gap-5 lg:grid-cols-2">
            {channels.map((channel) => (
              <ChannelCard key={channel.type} channel={channel} onSaved={() => void load()} />
            ))}
          </div>
        </>
      )}

      <section id="guia" className="surface mt-10 scroll-mt-24 p-6 sm:p-8" aria-labelledby="titulo-guia">
        <p className="eyebrow">Referencia</p>
        <h2 id="titulo-guia" className="mt-2 text-xl font-semibold text-text">
          Guía rápida de configuración
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Pasos resumidos para obtener cada credencial. La documentación completa vive en{" "}
          <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text">/docs/canales.md</code>.
        </p>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {GUIA.map((item) => (
            <div key={item.title} className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-text">{item.title}</h3>
              <ol className="mt-2 space-y-1.5 text-[0.8125rem] leading-relaxed text-muted">
                {item.steps.map((step) => (
                  <li key={step} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-muted/60" aria-hidden="true" />
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
