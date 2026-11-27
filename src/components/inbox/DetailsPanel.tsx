import { ArrowLeft, AtSign, Phone, ShieldCheck, Tag, UserRound } from "lucide-react";
import type { ApprovalView, ContactView, ConversationView } from "@/lib/contracts";
import { Badge, EmptyState, ErrorBanner } from "../ui";
import { ApprovalCard } from "./ApprovalCard";
import { STATUS_LABEL, STATUS_TONE } from "./format";

type Props = {
  contact: ContactView | null;
  conversation: ConversationView | null;
  approvals: ApprovalView[];
  conversations: ConversationView[];
  busyApprovalId: string | null;
  error: string | null;
  onApprove: (id: string, editedText?: string) => void;
  onReject: (id: string) => void;
  onBack: () => void;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function DetailsPanel({
  contact,
  conversation,
  approvals,
  conversations,
  busyApprovalId,
  error,
  onApprove,
  onReject,
  onBack,
}: Props) {
  const nameById = new Map(conversations.map((item) => [item.id, item.contactName]));
  const sorted = [...approvals].sort((a, b) => {
    if (a.conversationId === conversation?.id) return -1;
    if (b.conversationId === conversation?.id) return 1;
    return 0;
  });

  return (
    <aside className="flex min-h-0 flex-1 flex-col border-l border-border bg-surface xl:w-[340px] xl:flex-none" aria-label="Ficha del contacto y aprobaciones">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver al hilo de mensajes"
          className="-ml-1 rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-text xl:hidden"
        >
          <ArrowLeft size={19} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <h2 className="text-sm font-semibold text-text">Detalles</h2>
        <span className="ml-auto text-[0.6875rem] text-muted">{approvals.length} pendientes</span>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
        {error ? <ErrorBanner message={error} /> : null}

        <section aria-labelledby="ficha-contacto">
          <h3 id="ficha-contacto" className="eyebrow mb-3">
            Contacto
          </h3>
          {contact ? (
            <div className="surface-2 p-4">
              <div className="flex items-center gap-3">
                <span
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-3 font-display text-sm font-semibold text-muted"
                  aria-hidden="true"
                >
                  {initials(contact.displayName)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text">{contact.displayName}</p>
                  <p className="text-[0.75rem] text-muted">{contact.lifecycleStage}</p>
                </div>
              </div>
              <dl className="mt-4 space-y-2 text-[0.75rem]">
                <div className="flex items-center gap-2 text-muted">
                  <AtSign size={13} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                  <dt className="sr-only">Correo</dt>
                  <dd className="truncate font-mono text-text">{contact.email ?? "Sin correo"}</dd>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <Phone size={13} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                  <dt className="sr-only">Teléfono</dt>
                  <dd className="truncate font-mono text-text">{contact.phone ?? "Sin teléfono"}</dd>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <UserRound size={13} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                  <dt className="sr-only">Conversaciones</dt>
                  <dd className="tabular text-text">{contact.conversationCount} conversaciones</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="text-sm text-muted">Selecciona una conversación para ver la ficha del contacto.</p>
          )}

          {conversation?.labels.length ? (
            <div className="mt-4">
              <p className="eyebrow mb-2">Etiquetas</p>
              <div className="flex flex-wrap gap-1.5">
                {conversation.labels.map((label) => (
                  <Badge key={label} className="!px-2 !py-0.5 !text-[0.625rem]">
                    <Tag size={11} strokeWidth={1.75} aria-hidden="true" />
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {conversation ? (
            <div className="mt-4 flex items-center gap-2 text-xs text-muted">
              <Badge tone={STATUS_TONE[conversation.status]}>{STATUS_LABEL[conversation.status]}</Badge>
              {conversation.assigneeName ? <span>Asignada a {conversation.assigneeName}</span> : <span>Sin asignar</span>}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="bandeja-aprobaciones">
          <h3 id="bandeja-aprobaciones" className="eyebrow mb-3">
            Bandeja de aprobaciones
          </h3>
          {approvals.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="Todo al día"
              description="No hay respuestas esperando aprobación. Las propuestas de la IA aparecerán aquí."
            />
          ) : (
            <div className="space-y-3">
              {sorted.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  conversationName={nameById.get(approval.conversationId) ?? "Conversación"}
                  isCurrent={approval.conversationId === conversation?.id}
                  busy={busyApprovalId === approval.id}
                  onApprove={onApprove}
                  onReject={onReject}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
