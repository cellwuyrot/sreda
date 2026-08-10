"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { ClockIcon, PollIcon, XIcon } from "@/components/ui/ConnectIcons";

/* ════════════════════════════════════════════════════════════════════════
   Types
   ════════════════════════════════════════════════════════════════════ */

interface UserStub { id: string; name: string | null; avatar: string | null }

interface PollOptionData {
  id: string;
  text: string;
  votes: { userId: string }[];
}
interface PollData {
  id: string;
  question: string;
  anonymous: boolean;
  multiple: boolean;
  closed: boolean;
  userId: string;
  user: UserStub;
  options: PollOptionData[];
  createdAt: string;
}

/* ════════════════════════════════════════════════════════════════════════
   + Menu (dropdown for creating polls / tasks)
   ════════════════════════════════════════════════════════════════════ */

export function PlusMenu({
  channelId,
  onCreated,
  onAttach,
  onImage,
  onGeo,
  onToggleFormat,
  onSchedule,
  formatActive = false,
}: {
  channelId?: string;
  onCreated?: () => void;
  onAttach?: () => void;
  onImage?: () => void;
  onGeo?: () => void;
  onToggleFormat?: () => void;
  /** Отложенная отправка: открывает панель выбора времени в композере. */
  onSchedule?: () => void;
  formatActive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "poll">("menu");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setMode("menu");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(!open); setMode("menu"); }}
        className={`w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-xl transition-colors ${open || formatActive ? "text-violet-500 dark:text-cyan-400 bg-[var(--cn-accent-dim)]" : "text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 hover:bg-[var(--cn-hover)]"}`}
        aria-label="Инструменты сообщения"
        title="Инструменты сообщения"
        aria-expanded={open}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" />
          <path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
          {mode === "menu" && (
            <div className="p-2 space-y-1">
              <p className="px-3 pt-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Инструменты сообщения</p>
              {onAttach && <ToolAction label="Прикрепить файл" onClick={() => { setOpen(false); onAttach(); }} icon={<PaperclipIcon />} />}
              {onImage && <ToolAction label="Добавить изображение" onClick={() => { setOpen(false); onImage(); }} icon={<ImageIcon />} />}
              {onGeo && <ToolAction label="Отправить геолокацию" onClick={() => { setOpen(false); onGeo(); }} icon={<LocationIcon />} />}
              {onToggleFormat && <ToolAction label={formatActive ? "Скрыть форматирование" : "Форматирование"} onClick={() => { setOpen(false); onToggleFormat(); }} icon={<FormatIcon />} active={formatActive} />}
              {/* Отложенная отправка жила только в панели форматирования — там её
                  никто не искал: форматирование про текст, а не про время. */}
              {onSchedule && <ToolAction label="Отложенная отправка" onClick={() => { setOpen(false); onSchedule(); }} icon={<ClockIcon size={20} tone="inactive" />} />}
              {channelId && (
                <button onClick={() => setMode("poll")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 text-sm text-neutral-700 dark:text-gray-300">
                  <span className="w-6 h-6 inline-flex items-center justify-center"><PollIcon size={20} tone="inactive" /></span> Создать опрос
                </button>
              )}
            </div>
          )}

          {mode === "poll" && (
            <CreatePollForm
              channelId={channelId!}
              onDone={() => { setOpen(false); setMode("menu"); onCreated?.(); }}
              onCancel={() => setMode("menu")}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ToolAction({ label, onClick, icon, active = false }: { label: string; onClick: () => void; icon: ReactNode; active?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${active ? "bg-violet-50 text-violet-600 dark:bg-cyan-400/10 dark:text-cyan-300" : "text-neutral-700 dark:text-gray-300 hover:bg-neutral-100 dark:hover:bg-white/5"}`}>
      <span className="w-6 h-6 inline-flex items-center justify-center">{icon}</span>{label}
    </button>
  );
}

const iconClass = "w-5 h-5";
function PaperclipIcon() { return <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>; }
function ImageIcon() { return <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function LocationIcon() { return <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 21s7-5.1 7-12a7 7 0 1 0-14 0c0 6.9 7 12 7 12Z" strokeWidth="2"/><circle cx="12" cy="9" r="2.5" strokeWidth="2"/></svg>; }
function FormatIcon() { return <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M8 6v12m8-12v12M6 18h4m4 0h4" strokeWidth="2" strokeLinecap="round"/></svg>; }

/* ════════════════════════════════════════════════════════════════════════
   Create Poll Form
   ════════════════════════════════════════════════════════════════════ */

function CreatePollForm({ channelId, onDone, onCancel }: { channelId: string; onDone: () => void; onCancel: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [anonymous, setAnonymous] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [sending, setSending] = useState(false);

  const addOption = () => setOptions([...options, ""]);
  const removeOption = (i: number) => setOptions(options.filter((_, idx) => idx !== i));
  const updateOption = (i: number, v: string) => { const n = [...options]; n[i] = v; setOptions(n); };

  const submit = async () => {
    const valid = options.filter((o) => o.trim());
    if (!question.trim() || valid.length < 2) return;
    setSending(true);
    await fetch("/api/channels/polls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, question, options: valid, anonymous, multiple }),
    });
    setSending(false);
    onDone();
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">Новый опрос</h4>
        <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white text-xs">← Назад</button>
      </div>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Вопрос"
        className="w-full px-3 py-2 bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-lg text-sm text-neutral-900 dark:text-white placeholder-neutral-400"
      />
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder={`Вариант ${i + 1}`}
              className="flex-1 px-3 py-1.5 bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-lg text-sm text-neutral-900 dark:text-white placeholder-neutral-400"
            />
            {options.length > 2 && (
              <button onClick={() => removeOption(i)} className="px-2 text-red-400 hover:text-red-300" aria-label="Удалить вариант"><XIcon size={12} style={{ color: "inherit" }} /></button>
            )}
          </div>
        ))}
        {options.length < 10 && (
          <button onClick={addOption} className="text-xs text-violet-500 dark:text-cyan-400 hover:underline">+ Добавить вариант</button>
        )}
      </div>
      <div className="flex gap-4 text-xs text-neutral-500 dark:text-gray-400">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="rounded" />
          Анонимный
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="rounded" />
          Несколько ответов
        </label>
      </div>
      <button
        onClick={submit}
        disabled={sending || !question.trim() || options.filter((o) => o.trim()).length < 2}
        className="w-full py-2 bg-violet-600 dark:bg-cyan-500 text-white text-sm font-medium rounded-lg hover:bg-violet-700 dark:hover:bg-cyan-600 disabled:opacity-50"
      >
        {sending ? "Создание..." : "Создать опрос"}
      </button>
    </div>
  );
}
