"use client";

import { useEffect, useRef, useState } from "react";
import ModalBackdrop from "./ModalBackdrop";
import { XIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS
import { isAndroidShell, isAllowedShellPath } from "@/lib/shell"; // ANDROID-LOCK
import InfoTooltip from "@/components/ui/InfoTooltip";

const SCOPES = [
  { id: "all", label: "Везде" },
  { id: "messages", label: "Сообщения" },
  { id: "channels", label: "Каналы" },
  { id: "members", label: "Участники" },
  { id: "tasks", label: "Задачи" },
  { id: "wiki", label: "Wiki" },
  { id: "calendar", label: "Календарь" },
] as const;

type Scope = (typeof SCOPES)[number]["id"];
type Result = { id: string; type: Exclude<Scope, "all">; title: string; subtitle: string; snippet?: string; url: string };

/**
 * FIX-SEARCHMARK: подсветка совпадений.
 *
 * Раньше заголовок и фрагмент печатались как обычный текст, поэтому в списке
 * было непонятно, за что зацепился поиск, — особенно в длинном фрагменте на 180
 * символов. Отмечаем ровно вхождения запроса.
 *
 * Регулярку строим из запроса, поэтому спецсимволы экранируем: без этого ввод
 * «(» роняет конструктор RegExp и список результатов пропадает целиком.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(needle)})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === needle.toLowerCase()
          ? <mark key={index} className="rounded bg-violet-500/25 px-0.5 text-inherit dark:bg-cyan-400/25">{part}</mark>
          : <span key={index}>{part}</span>,
      )}
    </>
  );
}

const TYPE_LABEL: Record<Result["type"], string> = {
  messages: "Сообщение", channels: "Канал", members: "Участник", tasks: "Задача", wiki: "Wiki", calendar: "Событие",
};

export default function GlobalSearchModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/connect/search?q=${encodeURIComponent(query.trim())}&scope=${scope}`, { signal: controller.signal });
        const data = await response.json();
        if (response.ok) setResults(data.results ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults([]);
      } finally { setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, scope]);

  return (
    <ModalBackdrop onClose={onClose} maxWidth="max-w-3xl">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div><h3 className="text-lg font-semibold text-neutral-900 dark:text-white">Поиск в TZ.Connect<InfoTooltip text="По умолчанию ищет сразу везде. Если знаете, где искать, сузьте область кнопками ниже — сообщения, задачи, участники, статьи." side="bottom" className="ml-1" /></h3></div>
        <button onClick={onClose} className="w-9 h-9 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 text-neutral-500 inline-flex items-center justify-center" aria-label="Закрыть"><XIcon size={16} style={{ color: "inherit" }} /></button>
      </div>
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Сообщение, задача, участник, статья..." className="w-full rounded-full border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-800 py-3 pl-10 pr-4 text-sm text-neutral-900 dark:text-white outline-none focus:border-violet-400 dark:focus:border-cyan-400" />
      </div>
      <div className="flex gap-2 overflow-x-auto py-3" role="tablist" aria-label="Область поиска">
        {SCOPES.map((item) => <button key={item.id} onClick={() => setScope(item.id)} className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${scope === item.id ? "border-violet-500 bg-violet-500 text-white dark:border-cyan-400 dark:bg-cyan-400 dark:text-neutral-950" : "border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/5"}`} role="tab" aria-selected={scope === item.id}>{item.label}</button>)}
      </div>
      <div className="min-h-56 max-h-[55vh] overflow-y-auto rounded-2xl border border-neutral-200 p-1 dark:border-white/10">
        {loading && <div className="p-8 text-center text-sm text-neutral-500">Поиск…</div>}
        {!loading && query.trim().length < 2 && <div className="p-8 text-center text-sm text-neutral-500">Введите не менее двух символов</div>}
        {!loading && query.trim().length >= 2 && results.length === 0 && <div className="p-8 text-center text-sm text-neutral-500">Ничего не найдено</div>}
        {!loading && results.map((result) => (
          <button key={`${result.type}:${result.id}`} onClick={() => {
            /* ANDROID-LOCK: оболочка живёт строго в /connect — результаты из
               сайтовых разделов (например, статьи /library) в ней не открываем. */
            if (isAndroidShell()) {
              try {
                if (!isAllowedShellPath(new URL(result.url, window.location.origin).pathname)) return;
              } catch { return; }
            }
            window.location.href = result.url;
          }} className="w-full rounded-xl border-b border-neutral-100 dark:border-white/5 p-3 text-left last:border-0 hover:bg-neutral-50 dark:hover:bg-white/5">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-neutral-900 dark:text-white"><Highlighted text={result.title} query={query} /></p><p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{result.subtitle}</p></div><span className="rounded-md bg-neutral-100 dark:bg-white/10 px-2 py-1 text-[10px] text-neutral-500 dark:text-neutral-300">{TYPE_LABEL[result.type]}</span></div>
            {result.snippet && <p className="mt-1 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-300"><Highlighted text={result.snippet} query={query} /></p>}
          </button>
        ))}
      </div>
    </ModalBackdrop>
  );
}
