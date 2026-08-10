"use client";

import { useEffect, useState } from "react";
import { KeyboardIcon, CloseIcon } from "./icons";

/**
 * A compact, organized reference of every keyboard and mouse bind on the
 * Workspace canvas. Replaces the old single-line hint that crammed all the
 * shortcuts into one dense, hard-to-read strip.
 */

type Bind = { keys: string[]; label: string };
type Group = { title: string; binds: Bind[] };

const GROUPS: Group[] = [
  {
    title: "Навигация",
    binds: [
      { keys: ["ПКМ"], label: "Двигать холст" },
      { keys: ["Пробел", "ЛКМ"], label: "Двигать холст" },
      { keys: ["Колесо"], label: "Масштаб" },
      { keys: ["F"], label: "Вписать всё / выделение" },
    ],
  },
  {
    title: "Выделение",
    binds: [
      { keys: ["ЛКМ"], label: "Рамка выделения" },
      { keys: ["Shift", "ЛКМ"], label: "Добавить к выделению" },
      { keys: ["Ctrl", "A"], label: "Выделить всё" },
      { keys: ["Esc"], label: "Снять выделение" },
    ],
  },
  {
    title: "Узлы и связи",
    binds: [
      { keys: ["Выход", "→", "Вход"], label: "Соединить узлы" },
      { keys: ["Ctrl", "D"], label: "Дублировать" },
      { keys: ["Del"], label: "Удалить" },
    ],
  },
  {
    title: "История",
    binds: [
      { keys: ["Ctrl", "Z"], label: "Отменить" },
      { keys: ["Ctrl", "Shift", "Z"], label: "Вернуть" },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
      {children}
    </kbd>
  );
}

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="absolute bottom-4 right-4" onPointerDown={(e) => e.stopPropagation()}>
      {open && (
        <div className="absolute bottom-11 right-0 w-72 overflow-hidden rounded-xl border border-neutral-200 bg-white/95 shadow-lg backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
          <div className="flex items-center justify-between border-b border-neutral-100 px-3.5 py-2.5 dark:border-neutral-800">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Горячие клавиши
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white"
              aria-label="Закрыть"
            >
              <CloseIcon size={14} />
            </button>
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto px-3.5 py-3">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                  {g.title}
                </div>
                <ul className="space-y-1.5">
                  {g.binds.map((b, i) => (
                    <li key={i} className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-neutral-600 dark:text-neutral-300">{b.label}</span>
                      <span className="flex flex-shrink-0 items-center gap-1">
                        {b.keys.map((k, j) => (
                          <Kbd key={j}>{k}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Горячие клавиши"
        aria-label="Горячие клавиши"
        className={`flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm backdrop-blur transition-colors ${
          open
            ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-950"
            : "border-neutral-200 bg-white/90 text-neutral-500 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900/90 dark:text-neutral-400 dark:hover:text-white"
        }`}
      >
        <KeyboardIcon size={16} />
      </button>
    </div>
  );
}
