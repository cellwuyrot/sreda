"use client";

/**
 * FIX-BOARDPICKER: модальный выбор холста при клике «Отправить на доску».
 *
 * Показывает:
 *   – Личная рабочая среда (список холстов)
 *   – Для каждого canvas-канала группы: название + список холстов
 */

import { useEffect, useRef, useState } from "react";

interface BoardMeta { id: string; name: string; }
interface GroupCanvas { channelId: string; channelName: string; boards: BoardMeta[]; }
interface BoardList {
  personal: { boards: BoardMeta[] };
  group: GroupCanvas[];
}

export type BoardSelection = {
  boardId: string;
  scope: "personal" | "group";
  /** Только для группового холста: ID canvas-канала */
  channelId?: string;
};

const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export default function BoardPickerModal({
  groupId,
  onSelect,
  onClose,
}: {
  groupId?: string | null;
  onSelect: (sel: BoardSelection) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<BoardList | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ personal: true });

  useEffect(() => {
    const url = groupId
      ? `/api/workspace/board-list?groupId=${encodeURIComponent(groupId)}`
      : "/api/workspace/board-list";
    fetch(url)
      .then((r) => r.json())
      .then((data: BoardList) => { setList(data); setLoading(false); })
      .catch(() => { setErr("Не удалось загрузить холсты"); setLoading(false); });
  }, [groupId]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const toggle = (key: string) => setOpenSections((p) => ({ ...p, [key]: !p[key] }));

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.35)" }}
    >
      <div
        ref={ref}
        className="w-72 max-h-[70vh] overflow-hidden flex flex-col rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-neutral-100 dark:border-neutral-800">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <path d="M14 6.5h7" />
            <path d="M17.5 3v7" />
          </svg>
          <span className="text-sm font-semibold text-neutral-900 dark:text-white">Выбор холста</span>
          <button
            type="button" onClick={onClose} aria-label="Закрыть"
            className="ml-auto text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 py-2">
          {loading && <p className="px-4 py-3 text-xs text-neutral-500">Загрузка...</p>}
          {err && <p className="px-4 py-3 text-xs text-red-500">{err}</p>}
          {list && (
            <>
              {/* Личная рабочая среда */}
              <SectionHeader
                label="Личная рабочая среда"
                open={!!openSections["personal"]}
                onToggle={() => toggle("personal")}
              />
              {openSections["personal"] && list.personal.boards.map((b) => (
                <BoardRow
                  key={b.id}
                  name={b.name}
                  onClick={() => onSelect({ boardId: b.id, scope: "personal" })}
                />
              ))}

              {/* Групповые canvas-каналы */}
              {list.group.map((ch) => {
                const key = `g-${ch.channelId}`;
                return (
                  <div key={ch.channelId}>
                    <SectionHeader
                      label={ch.channelName}
                      sublabel="Групповая рабочая среда"
                      open={!!openSections[key]}
                      onToggle={() => toggle(key)}
                    />
                    {openSections[key] && ch.boards.map((b) => (
                      <BoardRow
                        key={b.id}
                        name={b.name}
                        onClick={() =>
                          onSelect({ boardId: b.id, scope: "group", channelId: ch.channelId })
                        }
                      />
                    ))}
                  </div>
                );
              })}

              {list.group.length === 0 && (
                <p className="px-4 py-2 text-[11px] text-neutral-400 dark:text-neutral-500">
                  {groupId
                    ? "В этом сообществе ещё нет разделов-холстов"
                    : "Холсты сообществ доступны в групповом чате"}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ label, sublabel, open, onToggle }: {
  label: string;
  sublabel?: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button" onClick={onToggle}
      className="w-full flex items-center gap-2 px-4 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
    >
      <IconChevron open={open} />
      <div className="flex flex-col min-w-0">
        <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide truncate">
          {label}
        </span>
        {sublabel && (
          <span className="text-[10px] text-neutral-400 dark:text-neutral-500 truncate">{sublabel}</span>
        )}
      </div>
    </button>
  );
}

function BoardRow({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className="w-full flex items-center gap-2.5 px-6 py-2 text-left text-sm text-neutral-700 dark:text-neutral-200 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
    >
      <svg
        width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="flex-shrink-0 opacity-50"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
      <span className="truncate">{name}</span>
    </button>
  );
}
