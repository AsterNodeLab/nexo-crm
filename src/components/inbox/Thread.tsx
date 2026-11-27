"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import clsx from "clsx";
import { ArrowLeft, PanelRightOpen, Paperclip, Send } from "lucide-react";
import type { ChannelType, MessageView } from "@/lib/contracts";
import { ChannelIcon } from "../ChannelIcon";
import { ErrorBanner } from "../ui";
import { clockTime } from "./format";

type Props = {
  contactName: string;
  channel: ChannelType | null;
  messages: MessageView[];
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onBack: () => void;
  onOpenDetails: () => void;
};

export function Thread({ contactName, channel, messages, sending, error, onSend, onBack, onOpenDetails }: Props) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    onSend(text);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-bg" aria-label={`Conversación con ${contactName}`}>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver a la lista de conversaciones"
          className="-ml-1 rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-text lg:hidden"
        >
          <ArrowLeft size={19} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-muted">
          {channel ? <ChannelIcon channel={channel} size={16} /> : null}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{contactName}</p>
          <p className="text-[0.6875rem] text-muted">{channel ?? "Canal sin identificar"}</p>
        </div>
        <button
          type="button"
          onClick={onOpenDetails}
          aria-label="Ver ficha y aprobaciones"
          className="ml-auto rounded-md p-2 text-muted hover:bg-surface-3 hover:text-text xl:hidden"
        >
          <PanelRightOpen size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-xs text-center text-sm text-muted">
              Todavía no hay mensajes en esta conversación. Escribe el primero para empezar.
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const outbound = message.direction === "outbound";
            return (
              <div key={message.id} className={clsx("flex", outbound ? "justify-end" : "justify-start")}>
                <div
                  className={clsx(
                    "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[76%]",
                    outbound
                      ? "rounded-br-sm border border-accent/15 bg-accent/8 text-text"
                      : "rounded-bl-sm border border-border bg-surface text-text",
                  )}
                >
                  <div className="mb-1.5 flex items-center gap-2 text-[0.6875rem] text-muted">
                    <span className="font-medium">{message.senderName}</span>
                    <span aria-hidden="true">·</span>
                    <time className="tabular font-mono">{clockTime(message.createdAt)}</time>
                    {outbound ? <span className="font-medium">Enviado</span> : null}
                  </div>
                  {message.text ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null}
                  {message.attachments.length > 0 ? (
                    <ul className="mt-2 space-y-1.5">
                      {message.attachments.map((attachment, index) => (
                        <li key={`${attachment.url}-${index}`}>
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1 text-xs text-text hover:underline"
                          >
                            <Paperclip size={13} strokeWidth={1.75} aria-hidden="true" />
                            <span className="truncate">{attachment.name ?? "Adjunto"}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-border bg-surface px-4 py-4 sm:px-6">
        {error ? <ErrorBanner message={error} /> : null}
        <form onSubmit={submit} className="flex items-end gap-2">
          <label htmlFor="nexo-composer" className="sr-only">
            Escribe tu respuesta
          </label>
          <textarea
            id="nexo-composer"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe una respuesta. Enter envía, Shift + Enter hace un salto de línea."
            className="input max-h-40 flex-1 resize-y py-2.5 text-sm"
          />
          <button type="submit" disabled={sending || draft.trim().length === 0} className="btn-primary shrink-0">
            <Send size={16} strokeWidth={1.75} aria-hidden="true" />
            {sending ? "Enviando" : "Enviar"}
          </button>
        </form>
      </div>
    </section>
  );
}
