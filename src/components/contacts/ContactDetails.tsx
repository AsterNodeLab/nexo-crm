import { AtSign, CalendarDays, Phone, MessagesSquare, X } from "lucide-react";
import type { ContactView } from "@/lib/contracts";
import { Badge } from "../ui";

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function ContactDetails({ contact, onClose }: { contact: ContactView; onClose: () => void }) {
  const attributes = Object.entries(contact.attributes);
  const created = new Date(contact.createdAt);
  const createdLabel = Number.isNaN(created.getTime())
    ? "—"
    : new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", year: "numeric" }).format(created);

  return (
    <aside className="surface flex min-h-0 w-full flex-col overflow-hidden xl:w-[320px]" aria-label={`Ficha de ${contact.displayName}`}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="text-sm font-semibold text-text">Ficha del contacto</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar ficha del contacto"
          className="ml-auto rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-text"
        >
          <X size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
        <div>
          <p className="font-display text-lg font-semibold text-text">{contact.displayName}</p>
          <div className="mt-2">
            <Badge>{contact.lifecycleStage}</Badge>
          </div>
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex items-start gap-2">
            <AtSign size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-xs text-muted">Correo</dt>
              <dd className="break-all font-mono text-[0.75rem] text-text">{contact.email ?? "Sin correo"}</dd>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Phone size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-xs text-muted">Teléfono</dt>
              <dd className="break-all font-mono text-[0.75rem] text-text">{contact.phone ?? "Sin teléfono"}</dd>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MessagesSquare size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            <div>
              <dt className="text-xs text-muted">Conversaciones</dt>
              <dd className="tabular text-text">{contact.conversationCount}</dd>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <CalendarDays size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            <div>
              <dt className="text-xs text-muted">Alta</dt>
              <dd className="text-text">{createdLabel}</dd>
            </div>
          </div>
        </dl>

        <section aria-labelledby="atributos-contacto">
          <h3 id="atributos-contacto" className="eyebrow mb-3">
            Atributos personalizados
          </h3>
          {attributes.length === 0 ? (
            <p className="text-sm text-muted">Este contacto aún no tiene atributos personalizados.</p>
          ) : (
            <dl className="space-y-2">
              {attributes.map(([key, value]) => (
                <div key={key} className="rounded-lg bg-surface-3 px-3 py-2">
                  <dt className="font-mono text-[0.625rem] uppercase tracking-wide text-muted">{key}</dt>
                  <dd className="mt-0.5 break-words font-mono text-[0.75rem] text-text">{displayValue(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
    </aside>
  );
}
