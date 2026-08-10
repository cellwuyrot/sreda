"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, CloseIcon, LayersIcon, PlusIcon, TrashIcon } from "./icons";

interface BoardMeta {
  id: string;
  name: string;
}

/**
 * Header control for switching between named working canvases. Shows the active
 * board's name; the dropdown lets the user switch, rename (double-click),
 * delete and create boards, up to `max`.
 */
export default function BoardSwitcher({
  boards,
  activeId,
  max,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: {
  boards: BoardMeta[];
  activeId: string;
  max: number;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const active = boards.find((b) => b.id === activeId);
  const atLimit = boards.length >= max;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setEditingId(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const startRename = (b: BoardMeta) => {
    setEditingId(b.id);
    setDraft(b.name);
  };

  const commitRename = () => {
    if (editingId) onRename(editingId, draft);
    setEditingId(null);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Рабочие холсты"
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5
          text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400
          dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-600"
      >
        <LayersIcon size={14} className="text-neutral-400 dark:text-neutral-500" />
        <span className="max-w-[9rem] truncate">{active?.name ?? "Холст"}</span>
        <span className="text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
          {boards.length}/{max}
        </span>
        <ChevronDownIcon size={12} className="opacity-60" />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-xl shadow-black/10 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/40">
          <div className="max-h-[60vh] overflow-y-auto">
            {boards.map((b) => {
              const isActive = b.id === activeId;
              const isEditing = editingId === b.id;
              return (
                <div
                  key={b.id}
                  className={`group flex items-center gap-2 px-2.5 py-2 text-xs transition-colors ${
                    isActive ? "bg-neutral-100 dark:bg-neutral-800/60" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  }`}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingId(null);
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-xs text-neutral-900 outline-none dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
                      maxLength={40}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onSwitch(b.id);
                        setOpen(false);
                      }}
                      onDoubleClick={() => startRename(b)}
                      title="Открыть · двойной клик — переименовать"
                      className={`min-w-0 flex-1 truncate text-left ${
                        isActive ? "font-semibold text-neutral-900 dark:text-white" : "text-neutral-600 dark:text-neutral-300"
                      }`}
                    >
                      {b.name}
                    </button>
                  )}

                  {isEditing ? (
                    <button
                      type="button"
                      onClick={commitRename}
                      className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                      aria-label="Готово"
                    >
                      <CloseIcon size={12} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onDelete(b.id)}
                      disabled={boards.length <= 1}
                      title="Удалить холст"
                      aria-label="Удалить холст"
                      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-neutral-300 opacity-0 transition-opacity hover:text-neutral-900 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 dark:text-neutral-600 dark:hover:text-white"
                    >
                      <TrashIcon size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => {
                onCreate();
                setOpen(false);
              }}
              disabled={atLimit}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <PlusIcon size={14} className="text-neutral-400 dark:text-neutral-500" />
              <span className="flex-1">Новый холст</span>
              {atLimit && <span className="text-[10px] text-neutral-400 dark:text-neutral-500">лимит {max}</span>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
