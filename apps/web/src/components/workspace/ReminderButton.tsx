"use client";

import { useEffect, useRef, useState } from "react";
import {
  REMINDER_PRESETS,
  isValidRemindAt,
  presetTime,
  reminderLabel,
  reminderState,
  type PresetId,
} from "@/lib/reminders";

/**
 * REMIND: колокольчик в шапке карточки.
 *
 * ── Почему на каждой карточке, а не только на задаче ────────────────────────
 *
 * Вернуться нужно не только к задаче: к заметке «дозвониться, когда откроются»,
 * к ссылке, которую отложил почитать, к таблице, которую надо свести в конце
 * месяца. Срок есть только у задачи, а напоминание нужно любому узлу — поэтому
 * колокольчик стоит в шапке, общей для всех.
 *
 * ── Почему заготовки, а не поле ввода ───────────────────────────────────────
 *
 * Девять раз из десяти нужное время — «через час» или «завтра утром». Поле с
 * датой и временем требует шести касаний ради того, что должно занимать одно;
 * поэтому оно есть, но спрятано под «Своё время».
 *
 * Само время хранится в карточке (колокольчик показывает состояние сразу, без
 * запроса) и дублируется на сервере, где и срабатывает (см. lib/reminders).
 */

function BellIcon({ size = 14, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
      aria-hidden
    >
      <path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 18a2 2 0 004 0" />
    </svg>
  );
}

/** Значение для поля «дата и время» из отметки времени. */
function toLocalInput(value: number): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export default function ReminderButton({
  remindAt,
  onChange,
}: {
  remindAt?: number | null;
  /** null — снять напоминание. */
  onChange: (remindAt: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const state = reminderState(remindAt);

  /* Щелчок мимо закрывает список: иначе он остаётся висеть поверх соседних
     карточек и перехватывает нажатия. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: PresetId) => {
    onChange(presetTime(id));
    setOpen(false);
    setCustom(false);
  };

  const tone =
    state === "fired"
      ? "text-amber-500"
      : state === "pending"
        ? "text-violet-500 dark:text-cyan-400"
        : "text-neutral-300 hover:text-neutral-900 dark:text-neutral-600 dark:hover:text-white";

  return (
    <div ref={boxRef} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setError("");
        }}
        title={reminderLabel(remindAt)}
        aria-label={reminderLabel(remindAt)}
        className={`transition-colors ${tone}`}
      >
        <BellIcon filled={state !== "none"} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-5 z-30 w-52 rounded-xl border border-neutral-200 bg-white p-1.5 text-[12px] shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {state !== "none" && (
            <div className="px-2 pb-1 pt-0.5 text-[11px] text-neutral-400">{reminderLabel(remindAt)}</div>
          )}

          {REMINDER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => pick(preset.id)}
              className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {preset.label}
            </button>
          ))}

          {custom ? (
            <div className="px-1 pt-1">
              <input
                type="datetime-local"
                autoFocus
                min={toLocalInput(Date.now() + 60_000)}
                onChange={(e) => {
                  const value = new Date(e.target.value).getTime();
                  if (!e.target.value) return;
                  if (!isValidRemindAt(value)) {
                    setError("Нужно время в будущем, не дальше года");
                    return;
                  }
                  setError("");
                  onChange(value);
                  setOpen(false);
                  setCustom(false);
                }}
                className="w-full rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-800"
              />
              {error && <div className="px-1 pt-1 text-[11px] text-red-500">{error}</div>}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Своё время…
            </button>
          )}

          {state !== "none" && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
                setCustom(false);
              }}
              className="mt-1 block w-full rounded-lg border-t border-neutral-100 px-2 py-1.5 text-left text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-red-500 dark:border-neutral-800 dark:hover:bg-neutral-800"
            >
              Убрать напоминание
            </button>
          )}
        </div>
      )}
    </div>
  );
}
