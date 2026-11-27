import clsx from "clsx";
import type { ConversationView } from "@/lib/contracts";
import { ChannelIcon } from "../ChannelIcon";
import { Badge } from "../ui";
import { PRIORITY_LABEL, PRIORITY_TONE, relativeTime } from "./format";

type Props = {
  conversation: ConversationView;
  active: boolean;
  onSelect: (id: string) => void;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function ConversationItem({ conversation, active, onSelect }: Props) {
  const showPriority = conversation.priority === "high" || conversation.priority === "urgent";

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-current={active ? "true" : undefined}
      className={clsx(
        "relative w-full border-b border-border px-4 py-3.5 text-left transition-colors",
        active ? "bg-accent/6" : "bg-surface hover:bg-surface-2",
      )}
    >
      {active ? <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" aria-hidden="true" /> : null}
      <div className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 font-display text-xs font-semibold text-muted"
          aria-hidden="true"
        >
          {initials(conversation.contactName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{conversation.contactName}</span>
            <span className="shrink-0 text-[0.6875rem] text-muted">{relativeTime(conversation.lastMessageAt)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge className="!px-2 !py-0.5 !text-[0.625rem]">
              <ChannelIcon channel={conversation.channel} size={12} />
              {conversation.channel}
            </Badge>
            {showPriority ? (
              <Badge tone={PRIORITY_TONE[conversation.priority]} className="!px-2 !py-0.5 !text-[0.625rem]">
                {PRIORITY_LABEL[conversation.priority]}
              </Badge>
            ) : null}
            {conversation.unread > 0 ? (
              <span className="tabular ml-auto grid min-w-5 place-items-center rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold text-text">
                {conversation.unread}
              </span>
            ) : null}
          </div>
          <p className="mt-2 truncate text-[0.8125rem] text-muted">
            {conversation.subject ? `${conversation.subject} · ` : ""}
            {conversation.lastMessage || "Sin mensajes todavía"}
          </p>
        </div>
      </div>
    </button>
  );
}
