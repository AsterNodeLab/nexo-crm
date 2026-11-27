"use client";

import { useState, type FormEvent } from "react";
import clsx from "clsx";
import { Check, Copy, LockKeyhole, Save } from "lucide-react";
import { CHANNEL_META, type ChannelView } from "@/lib/contracts";
import { ChannelIcon } from "../ChannelIcon";
import { Badge } from "../ui";

type Feedback = { tone: "success" | "error"; message: string };

function isMasked(value: string): boolean {
  return value.includes("•");
}

function initialValues(channel: ChannelView): Record<string, string> {
  const meta = CHANNEL_META[channel.type];
  const stored = new Map(channel.fields.map((field) => [field.key, field.value]));
  return Object.fromEntries(
    meta.fields.map((field) => {
      const value = stored.get(field.key) ?? "";
      return [field.key, field.secret && isMasked(value) ? "" : value];
    }),
  );
}

export function ChannelCard({ channel, onSaved }: { channel: ChannelView; onSaved: () => void }) {
  const meta = CHANNEL_META[channel.type];
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(channel));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [copied, setCopied] = useState(false);

  const storedValues = new Map(channel.fields.map((field) => [field.key, field.value]));

  function update(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setFeedback(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const config: Record<string, string> = {};
      for (const field of meta.fields) {
        const value = values[field.key] ?? "";
        // Un secreto vacío significa "conservar el valor cifrado actual".
        if (!field.secret || value.length > 0) config[field.key] = value;
      }
      const response = await fetch(`/api/channels/${channel.type}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!response.ok) throw new Error("El servidor rechazó la configuración. Revisa los datos e inténtalo de nuevo.");
      setFeedback({ tone: "success", message: "Cambios guardados." });
      setDirty(false);
      onSaved();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "No se pudo guardar la configuración.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function copyWebhook() {
    const url = channel.webhookUrl ?? meta.webhookPath ?? "";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFeedback({ tone: "error", message: "No se pudo copiar. Selecciona la URL manualmente." });
    }
  }

  return (
    <article className="surface flex flex-col p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-3 text-muted" aria-hidden="true">
          <ChannelIcon channel={channel.type} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-text">{meta.label}</h3>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{meta.description}</p>
        </div>
        <Badge tone={channel.enabled ? "success" : "neutral"} className="shrink-0">
          {channel.enabled ? "Configurado" : "Pendiente"}
        </Badge>
      </div>

      {meta.webhookPath ? (
        <div className="mt-5">
          <p className="label">URL del webhook</p>
          <div className="flex items-center gap-2 rounded-lg bg-surface-3 px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[0.75rem] text-text">
              {channel.webhookUrl ?? meta.webhookPath}
            </code>
            <button
              type="button"
              onClick={() => void copyWebhook()}
              aria-label={`Copiar URL del webhook de ${meta.label}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-[0.6875rem] font-medium text-muted hover:text-text"
            >
              {copied ? <Check size={13} strokeWidth={1.75} aria-hidden="true" /> : <Copy size={13} strokeWidth={1.75} aria-hidden="true" />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={(event) => void save(event)} className="mt-6 flex flex-1 flex-col">
        <div className="grid gap-4 sm:grid-cols-2">
          {meta.fields.map((field) => {
            const savedValue = storedValues.get(field.key) ?? "";
            const hasSavedSecret = Boolean(field.secret && isMasked(savedValue));
            return (
              <div key={field.key} className={field.key.length > 14 ? "sm:col-span-2" : undefined}>
                <label htmlFor={`${channel.type}-${field.key}`} className="label flex items-center gap-2">
                  {field.label}
                  {hasSavedSecret ? (
                    <span className="inline-flex items-center gap-1 font-mono text-[0.625rem] normal-case text-muted">
                      <LockKeyhole size={11} strokeWidth={1.75} aria-hidden="true" />
                      Guardado
                    </span>
                  ) : null}
                </label>
                <input
                  id={`${channel.type}-${field.key}`}
                  type={field.secret ? "password" : "text"}
                  value={values[field.key] ?? ""}
                  onChange={(event) => update(field.key, event.target.value)}
                  placeholder={hasSavedSecret ? "••••••••" : field.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="input font-mono text-[0.8125rem]"
                />
                <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">{field.help}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
          <button type="submit" disabled={saving || !dirty} className="btn-primary">
            <Save size={16} strokeWidth={1.75} aria-hidden="true" />
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
          {feedback ? (
            <p role="status" className={clsx("text-xs", feedback.tone === "success" ? "text-success" : "text-danger")}>
              {feedback.message}
            </p>
          ) : (
            <p className="text-xs text-muted">Los cambios no se envían hasta que guardes.</p>
          )}
        </div>
      </form>
    </article>
  );
}
