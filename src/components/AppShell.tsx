"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Inbox, Menu, Radio, Settings2, ShieldCheck, Users, X } from "lucide-react";
import type { StatsView } from "@/lib/contracts";
import { fetchApi, REFRESH_EVENT } from "./api";

const NAV = [
  { href: "/inbox", label: "Inbox", icon: Inbox, description: "Conversaciones" },
  { href: "/contactos", label: "Contactos", icon: Users, description: "Directorio" },
  { href: "/canales", label: "Canales", icon: Radio, description: "Conexiones" },
  { href: "/ajustes", label: "Ajustes", icon: Settings2, description: "Configuración" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);

  const section = NAV.find((item) => pathname.startsWith(item.href));
  const title = section?.label ?? "Nexo";

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    let active = true;
    const load = () => {
      void fetchApi<StatsView>("/api/stats")
        .then((stats) => {
          if (active) setPendingApprovals(stats.pendingApprovals);
        })
        .catch(() => {
          if (active) setPendingApprovals(null);
        });
    };
    load();
    const interval = window.setInterval(load, 15_000);
    window.addEventListener(REFRESH_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener(REFRESH_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
      >
        Saltar al contenido
      </a>

      {menuOpen ? (
        <button
          type="button"
          aria-label="Cerrar menú de navegación"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 bg-text/25 lg:hidden"
        />
      ) : null}

      <aside
        id="nexo-sidebar"
        aria-label="Navegación principal"
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-surface transition-transform duration-200 lg:translate-x-0",
          menuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent font-display text-base font-bold text-accent-ink"
            aria-hidden="true"
          >
            N
          </span>
          <div className="min-w-0">
            <p className="font-display text-lg font-bold leading-none tracking-tight text-text">NEXO</p>
            <p className="eyebrow mt-1.5 !text-[0.5625rem]">CRM conversacional</p>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            aria-label="Cerrar menú"
            className="ml-auto rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-text lg:hidden"
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-6">
          <p className="eyebrow px-3 pb-2">Espacio de trabajo</p>
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-accent/8 font-semibold text-accent"
                    : "text-muted hover:bg-surface-3 hover:text-text",
                )}
              >
                <Icon size={19} strokeWidth={1.75} aria-hidden="true" />
                <span>{item.label}</span>
                <span className="ml-auto hidden font-mono text-[0.625rem] text-muted/70 xl:inline">
                  {item.description}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-4">
          <div className="surface-2 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-text">
              <ShieldCheck size={15} strokeWidth={1.75} className="text-success" aria-hidden="true" />
              IA supervisada
            </div>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
              Toda respuesta propuesta pasa por aprobación antes de enviarse.
            </p>
          </div>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="nexo-sidebar"
            aria-label={menuOpen ? "Cerrar menú de navegación" : "Abrir menú de navegación"}
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-lg border border-border bg-surface p-2 text-muted hover:text-text lg:hidden"
          >
            {menuOpen ? <X size={18} strokeWidth={1.75} aria-hidden="true" /> : <Menu size={18} strokeWidth={1.75} aria-hidden="true" />}
          </button>

          <div className="min-w-0">
            <p className="eyebrow hidden sm:block">Nexo / {section?.description ?? "Espacio de trabajo"}</p>
            <h1 className="truncate font-display text-base font-semibold text-text sm:text-lg">{title}</h1>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <div className="hidden items-center gap-2 text-xs text-muted sm:flex">
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              Sistema activo
            </div>
            <Link
              href="/inbox"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:border-accent/30 hover:text-text"
              aria-label={`Aprobaciones pendientes: ${pendingApprovals ?? "sin datos"}`}
            >
              <ShieldCheck size={15} strokeWidth={1.75} aria-hidden="true" />
              <span className="hidden sm:inline">Aprobaciones</span>
              <span
                className={clsx(
                  "tabular grid min-w-5 place-items-center rounded-full px-1 font-mono text-[0.6875rem] font-semibold",
                  pendingApprovals && pendingApprovals > 0 ? "bg-accent text-accent-ink" : "bg-surface-3 text-muted",
                )}
              >
                {pendingApprovals ?? "–"}
              </span>
            </Link>
          </div>
        </header>

        <main id="contenido" className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
