"use client";
import { useEffect, useState } from "react";
import LinkPreviewCard from "./LinkPreviewCard";
type State = { hidden: boolean; suppressed: boolean; canSuppress: boolean };
export interface PreviewEvent {
  scope: "channel" | "dm";
  id: string;
  hidden?: boolean;
  suppressed?: boolean;
}
export function notifyPreviewState(detail: PreviewEvent) {
  window.dispatchEvent(new CustomEvent("trioz-link-preview", { detail }));
}
/** Personal choices are stored server-side and read before loading external metadata. */
export default function MessageLinkPreview({
  scope,
  messageId,
  url,
  suppressed = false,
}: {
  scope: "channel" | "dm";
  messageId: string;
  url: string;
  suppressed?: boolean;
}) {
  const [state, setState] = useState<State | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setState(null);
    setError("");
    if (messageId.startsWith("opt-")) return;
    const ctrl = new AbortController();
    void fetch(
      `/api/messages/preview?scope=${scope}&messageId=${encodeURIComponent(messageId)}`,
      {
        cache: "no-store",
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(10000)]),
      },
    )
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => {
        if (!ctrl.signal.aborted) setState(d);
      })
      .catch(() => {
        if (!ctrl.signal.aborted)
          setError("Не удалось проверить настройки превью");
      });
    return () => ctrl.abort();
  }, [scope, messageId, attempt]);
  useEffect(() => {
    setState((old) => (old ? { ...old, suppressed } : old));
  }, [suppressed]);
  useEffect(() => {
    const listen = (event: Event) => {
      const d = (event as CustomEvent<PreviewEvent>).detail;
      if (d.scope === scope && d.id === messageId)
        setState((old) =>
          old
            ? {
                ...old,
                ...(d.hidden === undefined ? {} : { hidden: d.hidden }),
                ...(d.suppressed === undefined
                  ? {}
                  : { suppressed: d.suppressed }),
              }
            : old,
        );
    };
    window.addEventListener("trioz-link-preview", listen);
    return () => window.removeEventListener("trioz-link-preview", listen);
  }, [scope, messageId]);
  async function change(action: "personal" | "author", value: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/messages/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ scope, messageId, action, value }),
      });
      if (!r.ok) throw Error();
      const d = await r.json();
      setState((old) => (old ? { ...old, ...d } : old));
      notifyPreviewState({ scope, id: messageId, ...d });
    } catch {
      setError("Не удалось сохранить. Повторите попытку.");
    } finally {
      setBusy(false);
    }
  }
  if (!state)
    return error ? (
      <button
        type="button"
        className="link-preview-restore"
        onClick={() => setAttempt((n) => n + 1)}
      >
        {error} · Повторить
      </button>
    ) : null;
  return (
    <div className="message-link-preview">
      {!state.hidden && !state.suppressed && <LinkPreviewCard url={url} />}
      <div className="link-preview-actions">
        {state.suppressed ? (
          <>
            {state.canSuppress && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void change("author", false)}
              >
                Вернуть превью для всех
              </button>
            )}
          </>
        ) : state.hidden ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void change("personal", false)}
          >
            Превью скрыто у вас · Вернуть
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void change("personal", true)}
          >
            × Скрыть у меня
          </button>
        )}
        {state.canSuppress && !state.suppressed && (
          <details>
            <summary>Действия автора</summary>
            <button
              type="button"
              disabled={busy}
              onClick={() => void change("author", true)}
            >
              Убрать превью у всех
            </button>
          </details>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
