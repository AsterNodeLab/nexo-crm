"use client";

import { useState } from "react";
import { Ban, Check, Clock3, ExternalLink, Pencil, Sparkles, X } from "lucide-react";
import type { ApprovalView } from "@/lib/contracts";
import { Badge } from "../ui";
import { relativeTime } from "./format";

type Props = {
  approval: ApprovalView;
  conversationName: string;
  isCurrent: boolean;
  busy: boolean;
  onApprove: (id: string, editedText?: string) => void;
  onReject: (id: string) => void;
};

const actionClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[0.75rem] font-medium text-text hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50";

export function ApprovalCard({ approval, conversationName, isCurrent, busy, onApprove, onReject }: Props) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(approval.editedText ?? approval.proposalText);

  function approveWithEdit() {
    const trimmed = editText.trim();
    const original = (approval.editedText ?? approval.proposalText).trim();
    onApprove(approval.id, trimmed !== original ? trimmed : undefined);
    setEditing(false);
  }

  return (
    <article className="surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent" className="!px-2 !py-0.5 !text-[0.625rem]">
          <Sparkles size={11} strokeWidth={1.75} aria-hidden="true" />
          Propuesta de IA
        </Badge>
        {isCurrent ? (
          <Badge className="!px-2 !py-0.5 !text-[0.625rem]">Esta conversación</Badge>
        ) : null}
        <span className="ml-auto text-[0.6875rem] text-muted">{approval.channel}</span>
      </div>

      <p className="mt-3 text-[0.75rem] text-muted">
        Para <span className="font-medium text-text">{conversationName}</span>
      </p>
      <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3 py-2.5 text-[0.8125rem] leading-relaxed text-text">
        {approval.editedText ?? approval.proposalText}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted">
        <span className="inline-flex items-center gap-1">
          <Clock3 size={12} strokeWidth={1.75} aria-hidden="true" />
          Expira {relativeTime(approval.expiresAt)}
        </span>
        {approval.model ? <span className="truncate font-mono">{approval.model}</span> : null}
      </div>

      {approval.citations.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {approval.citations.map((citation, index) => (
            <li key={`${citation.title}-${index}`} className="text-[0.6875rem] text-muted">
              {citation.url ? (
                <a href={citation.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent hover:underline">
                  <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
                  {citation.title}
                </a>
              ) : (
                citation.title
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {editing ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`editar-${approval.id}`} className="label">
            Editar respuesta antes de aprobar
          </label>
          <textarea
            id={`editar-${approval.id}`}
            rows={5}
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            className="input resize-y py-2 text-[0.8125rem]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={approveWithEdit}
              disabled={busy || editText.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check size={14} strokeWidth={1.75} aria-hidden="true" />
              Aprobar edición
            </button>
            <button type="button" onClick={() => setEditing(false)} className={actionClass} disabled={busy}>
              <X size={14} strokeWidth={1.75} aria-hidden="true" />
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onApprove(approval.id)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={14} strokeWidth={1.75} aria-hidden="true" />
            Aprobar
          </button>
          <button type="button" onClick={() => setEditing(true)} className={actionClass} disabled={busy}>
            <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
            Editar
          </button>
          <button type="button" onClick={() => onReject(approval.id)} className={actionClass} disabled={busy}>
            <Ban size={14} strokeWidth={1.75} aria-hidden="true" />
            Rechazar
          </button>
        </div>
      )}
    </article>
  );
}
