"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Search, Users } from "lucide-react";
import type { ContactView } from "@/lib/contracts";
import { AppShell } from "@/components/AppShell";
import { fetchApi } from "@/components/api";
import { ContactDetails } from "@/components/contacts/ContactDetails";
import { Badge, EmptyState, ErrorBanner, LoadingState, PageHeader } from "@/components/ui";

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function ContactosPage() {
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [selected, setSelected] = useState<ContactView | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const list = await fetchApi<ContactView[]>("/api/contacts");
      setContacts(list);
      setError(null);
    } catch (loadError) {
      setError(messageFrom(loadError, "No se pudo cargar el directorio de contactos."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    if (!needle) return contacts;
    return contacts.filter((contact) =>
      [contact.displayName, contact.email ?? "", contact.phone ?? "", contact.lifecycleStage].some((value) =>
        value.toLocaleLowerCase("es").includes(needle),
      ),
    );
  }, [contacts, query]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Directorio"
        title="Contactos"
        description="Personas que han escrito a tus canales, con su historial y atributos."
      >
        <Badge className="!px-3 !py-1.5 !text-xs">
          <Users size={13} strokeWidth={1.75} aria-hidden="true" />
          <span className="tabular">{contacts.length} contactos</span>
        </Badge>
      </PageHeader>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className={clsx("grid gap-5", selected ? "xl:grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-1")}>
        <section className="surface min-w-0 overflow-hidden" aria-label="Tabla de contactos">
          <div className="border-b border-border px-4 py-4">
            <div className="relative max-w-sm">
              <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
              <label htmlFor="buscar-contactos" className="sr-only">
                Buscar contactos
              </label>
              <input
                id="buscar-contactos"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nombre, correo o teléfono"
                className="input pl-9"
              />
            </div>
          </div>

          {loading ? (
            <LoadingState label="Cargando contactos…" />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No hay contactos que mostrar"
              description="Cuando alguien escriba a cualquiera de tus canales, su ficha aparecerá aquí."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th scope="col" className="eyebrow px-4 py-3 font-normal">Nombre</th>
                    <th scope="col" className="eyebrow px-4 py-3 font-normal">Correo</th>
                    <th scope="col" className="eyebrow px-4 py-3 font-normal">Teléfono</th>
                    <th scope="col" className="eyebrow px-4 py-3 font-normal">Etapa</th>
                    <th scope="col" className="eyebrow px-4 py-3 text-right font-normal">Conversaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((contact) => {
                    const active = selected?.id === contact.id;
                    return (
                      <tr
                        key={contact.id}
                        onClick={() => setSelected(contact)}
                        className={clsx(
                          "cursor-pointer border-b border-border last:border-0 transition-colors",
                          active ? "bg-accent/6" : "hover:bg-surface-2",
                        )}
                      >
                        <td className="px-4 py-3.5">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelected(contact);
                            }}
                            className="font-medium text-text hover:underline"
                            aria-label={`Ver ficha de ${contact.displayName}`}
                          >
                            {contact.displayName}
                          </button>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-muted">{contact.email ?? "—"}</td>
                        <td className="px-4 py-3.5 font-mono text-xs text-muted">{contact.phone ?? "—"}</td>
                        <td className="px-4 py-3.5">
                          <Badge>{contact.lifecycleStage}</Badge>
                        </td>
                        <td className="tabular px-4 py-3.5 text-right text-text">{contact.conversationCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selected ? <ContactDetails contact={selected} onClose={() => setSelected(null)} /> : null}
      </div>
    </AppShell>
  );
}
