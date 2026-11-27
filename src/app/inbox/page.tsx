"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Inbox as InboxIcon, Search, ShieldCheck } from "lucide-react";
import {
  CHANNEL_META,
  SSE_EVENTS,
  type ApprovalView,
  type ChannelType,
  type ContactView,
  type ConversationStatus,
  type ConversationView,
  type MessageView,
} from "@/lib/contracts";
import { AppShell } from "@/components/AppShell";
import { fetchApi, jsonRequest, notifyRefresh } from "@/components/api";
import { EmptyState, ErrorBanner, LoadingState } from "@/components/ui";
import { ConversationItem } from "@/components/inbox/ConversationItem";
import { DetailsPanel } from "@/components/inbox/DetailsPanel";
import { Thread } from "@/components/inbox/Thread";
import { STATUS_LABEL } from "@/components/inbox/format";

type StatusFilter = "all" | ConversationStatus;
type MobileStep = "list" | "thread" | "panel";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "open", label: STATUS_LABEL.open },
  { value: "pending", label: STATUS_LABEL.pending },
  { value: "resolved", label: STATUS_LABEL.resolved },
];

const CHANNEL_OPTIONS = Object.keys(CHANNEL_META) as ChannelType[];

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationView | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [contact, setContact] = useState<ContactView | null>(null);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelType | "all">("all");
  const [query, setQuery] = useState("");
  const [mobileStep, setMobileStep] = useState<MobileStep>("list");
  const [streamMode, setStreamMode] = useState<"live" | "polling">("live");

  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  const loadConversations = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingList(true);
      try {
        const params = new URLSearchParams();
        if (statusFilter !== "all") params.set("status", statusFilter);
        if (channelFilter !== "all") params.set("channel", channelFilter);
        const search = params.toString();
        const list = await fetchApi<ConversationView[]>(`/api/conversations${search ? `?${search}` : ""}`);
        setConversations(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
        setListError(null);
      } catch (error) {
        setListError(messageFrom(error, "No se pudieron cargar las conversaciones."));
      } finally {
        if (!silent) setLoadingList(false);
      }
    },
    [statusFilter, channelFilter],
  );

  const loadApprovals = useCallback(async () => {
    try {
      const list = await fetchApi<ApprovalView[]>("/api/approvals?status=pending");
      setApprovals(list);
      setApprovalError(null);
    } catch (error) {
      setApprovalError(messageFrom(error, "No se pudo cargar la bandeja de aprobaciones."));
    }
  }, []);

  const loadThread = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoadingThread(true);
    try {
      const detail = await fetchApi<{ conversation: ConversationView; messages: MessageView[] }>(
        `/api/conversations/${id}`,
      );
      setActiveConversation(detail.conversation);
      setMessages(Array.isArray(detail.messages) ? detail.messages : []);
      setComposerError(null);
      try {
        const found = await fetchApi<ContactView>(`/api/contacts/${detail.conversation.contactId}`);
        setContact(found);
      } catch {
        setContact(null);
      }
    } catch (error) {
      setComposerError(messageFrom(error, "No se pudo cargar esta conversación."));
    } finally {
      if (!silent) setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (!selectedId) {
      setActiveConversation(null);
      setMessages([]);
      setContact(null);
      return;
    }
    void loadThread(selectedId);
  }, [selectedId, loadThread]);

  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    refreshRef.current = () => {
      void loadConversations(true);
      void loadApprovals();
      const id = selectedIdRef.current;
      if (id) void loadThread(id, true);
    };
  }, [loadConversations, loadApprovals, loadThread]);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let pollTimer: number | null = null;
    let reconnectTimer: number | null = null;

    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (pollTimer !== null || disposed) return;
      pollTimer = window.setInterval(() => refreshRef.current(), 5000);
    };

    const connect = () => {
      if (disposed) return;
      if (typeof EventSource === "undefined") {
        setStreamMode("polling");
        startPolling();
        return;
      }

      const next = new EventSource("/api/stream");
      source = next;

      next.onopen = () => {
        if (disposed) {
          next.close();
          return;
        }
        stopPolling();
        setStreamMode("live");
      };

      next.onerror = () => {
        next.close();
        if (source === next) source = null;
        if (disposed) return;
        setStreamMode("polling");
        startPolling();
        if (reconnectTimer === null) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 15_000);
        }
      };

      for (const event of Object.values(SSE_EVENTS)) {
        next.addEventListener(event, () => refreshRef.current());
      }
    };

    connect();
    return () => {
      disposed = true;
      stopPolling();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    if (!needle) return conversations;
    return conversations.filter((item) =>
      [item.contactName, item.lastMessage, item.subject ?? "", item.channel].some((value) =>
        value.toLocaleLowerCase("es").includes(needle),
      ),
    );
  }, [conversations, query]);

  async function handleSend(text: string) {
    if (!selectedId) return;
    setSending(true);
    setComposerError(null);
    try {
      const created = await fetchApi<MessageView>(
        `/api/conversations/${selectedId}/messages`,
        jsonRequest("POST", { text }),
      );
      setMessages((current) => (current.some((item) => item.id === created.id) ? current : [...current, created]));
      notifyRefresh();
      void loadConversations(true);
    } catch (error) {
      setComposerError(messageFrom(error, "No se pudo enviar el mensaje."));
    } finally {
      setSending(false);
    }
  }

  async function decideApproval(id: string, decision: "approve" | "reject", editedText?: string) {
    setBusyApprovalId(id);
    setApprovalError(null);
    try {
      await fetchApi<unknown>(
        `/api/approvals/${id}/${decision}`,
        jsonRequest("POST", editedText ? { editedText } : {}),
      );
      setApprovals((current) => current.filter((item) => item.id !== id));
      notifyRefresh();
      void loadApprovals();
      void loadConversations(true);
    } catch (error) {
      setApprovalError(messageFrom(error, "No se pudo registrar la decisión."));
    } finally {
      setBusyApprovalId(null);
    }
  }

  function selectConversation(id: string) {
    setSelectedId(id);
    setMobileStep("thread");
  }

  const current = activeConversation ?? conversations.find((item) => item.id === selectedId) ?? null;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Centro de operaciones</p>
          <h2 className="mt-2 text-2xl font-semibold sm:text-[1.75rem]">Un solo inbox</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Todas tus conversaciones, con respuestas de IA siempre supervisadas por una persona.
          </p>
        </div>
        <p className="inline-flex items-center gap-2 text-xs text-muted">
          <span className={clsx("size-2 rounded-full", streamMode === "live" ? "bg-success" : "bg-warning")} aria-hidden="true" />
          {streamMode === "live" ? "Actualizaciones en vivo" : "Actualizando cada 5 segundos"}
        </p>
      </div>

      {listError ? <ErrorBanner message={listError} onRetry={() => void loadConversations()} /> : null}

      <div className="flex h-[calc(100dvh-11rem)] min-h-[520px] overflow-hidden rounded-card border border-border bg-surface shadow-[0_1px_2px_rgb(26_29_33/0.03)] xl:grid xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        <section
          aria-label="Lista de conversaciones"
          className={clsx(
            "w-full shrink-0 flex-col border-b border-border xl:flex xl:w-auto xl:border-b-0 xl:border-r",
            mobileStep === "list" ? "flex" : "hidden",
          )}
        >
          <div className="shrink-0 space-y-3 border-b border-border bg-surface-2 px-4 py-4">
            <div className="relative">
              <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
              <label htmlFor="buscar-conversaciones" className="sr-only">
                Buscar conversaciones
              </label>
              <input
                id="buscar-conversaciones"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nombre o mensaje"
                className="input pl-9"
              />
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setStatusFilter(filter.value)}
                  aria-pressed={statusFilter === filter.value}
                  className={clsx(
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    statusFilter === filter.value
                      ? "bg-accent/10 font-semibold text-accent"
                      : "text-muted hover:bg-surface-3 hover:text-text",
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="filtro-canal" className="sr-only">
                Filtrar por canal
              </label>
              <select
                id="filtro-canal"
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value as ChannelType | "all")}
                className="input min-h-9 py-1 text-xs"
              >
                <option value="all">Todos los canales</option>
                {CHANNEL_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {CHANNEL_META[type].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList ? (
              <LoadingState label="Cargando conversaciones…" />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={InboxIcon}
                title="No hay conversaciones todavía"
                description="Conecta un canal para empezar. También puedes ajustar los filtros de esta lista."
                action={
                  <Link href="/canales" className="btn-secondary">
                    Configurar canales
                  </Link>
                }
              />
            ) : (
              filtered.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === selectedId}
                  onSelect={selectConversation}
                />
              ))
            )}
          </div>
        </section>

        <div
          className={clsx(
            "min-h-0 min-w-0 flex-1 xl:flex",
            mobileStep === "thread" ? "flex" : "hidden",
          )}
        >
          {selectedId ? (
            loadingThread ? (
              <LoadingState label="Abriendo conversación…" />
            ) : (
              <Thread
                contactName={current?.contactName ?? "Conversación"}
                channel={current?.channel ?? null}
                messages={messages}
                sending={sending}
                error={composerError}
                onSend={(text) => void handleSend(text)}
                onBack={() => setMobileStep("list")}
                onOpenDetails={() => setMobileStep("panel")}
              />
            )
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="Selecciona una conversación"
              description="El hilo y las aprobaciones pendientes aparecerán aquí."
            />
          )}
        </div>

        <div
          className={clsx("min-h-0 w-full xl:flex xl:w-auto", mobileStep === "panel" ? "flex" : "hidden")}
        >
          <DetailsPanel
            contact={contact}
            conversation={current}
            approvals={approvals}
            conversations={conversations}
            busyApprovalId={busyApprovalId}
            error={approvalError}
            onApprove={(id, editedText) => void decideApproval(id, "approve", editedText)}
            onReject={(id) => void decideApproval(id, "reject")}
            onBack={() => setMobileStep("thread")}
          />
        </div>
      </div>
    </>
  );
}
