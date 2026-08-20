"use client";

/**
 * FIX-FWDBUF: полоса «пересылка ждёт получателя» над полем ввода.
 *
 * Появляется во всех чатах сразу, как в буфере появилось сообщение, и исчезает
 * после отправки или отмены. Сама полоса ничего не отправляет: куда и каким
 * маршрутом — знает тот, кто её встроил (канал или ЛС).
 */

import { useEffect, useState } from "react";
import {
  clearForward,
  peekForward,
  subscribeForward,
  type ForwardItem,
} from "@/lib/forwardBuffer";

export default function ForwardPendingBar({
  onSendHere,
  disabled,
  hereLabel = "Переслать сюда",
}: {
  /** Отправить сообщение в ТЕКУЩИЙ чат. `true` — успешно. */
  onSendHere: (item: ForwardItem) => Promise<boolean>;
  disabled?: boolean;
  hereLabel?: string;
}) {
  const [item, setItem] = useState<ForwardItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  /* Чтение localStorage — только после монтирования: на сервере его нет, и
     начальное состояние из него дало бы расхождение разметки. */
  useEffect(() => {
    setItem(peekForward());
    return subscribeForward((next) => {
      setItem(next);
      setError(false);
    });
  }, []);

  if (!item) return null;

  const preview = (item.content || "Вложение").replace(/\s+/g, " ").slice(0, 70);

  return (
    <div className="tz-fwd-bar mb-2 flex items-center gap-2 rounded-xl border border-violet-300/70 bg-violet-50 px-3 py-2 dark:border-cyan-400/40 dark:bg-cyan-400/10">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-violet-700 dark:text-cyan-300">
          {error ? "Не удалось переслать — попробуйте ещё раз" : "Сообщение скопировано — выберите получателя"}
        </div>
        <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
          от {item.userName || "неизвестного"}: {preview}
        </div>
      </div>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            const ok = await onSendHere(item);
            if (ok) clearForward();
            else setError(true);
          } finally {
            setBusy(false);
          }
        }}
        className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
      >
        {busy ? "Отправка…" : hereLabel}
      </button>
      <button
        type="button"
        onClick={() => clearForward()}
        className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] text-neutral-500 transition-colors hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        Отмена
      </button>
    </div>
  );
}
