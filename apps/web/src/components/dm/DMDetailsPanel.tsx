"use client";
import { useEffect, useRef, useState } from "react";
import { X, Search, FileText, ArrowUpRight, Download } from "lucide-react";
interface Item { id?: string; messageId?: string; content?: string; user?: { name: string }; userName?: string; createdAt: string; url?: string; name?: string; size?: number; isImage?: boolean; isVideo?: boolean; isVoice?: boolean; isE2EE?: boolean; e2eeIv?: string }
export default function DMDetailsPanel({ conversationId, mode, onClose, onJump }: { conversationId: string; mode: "search" | "materials"; onClose: () => void; onJump: (id: string) => void }) {
  const [tab, setTab] = useState("files"), [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]), [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [page, setPage] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>(mode === "search" ? "input" : "button")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus(); };
  }, [onClose, mode]);
  useEffect(() => {
    const ac = new AbortController();
    if (mode === "search" && query.trim().length < 2) { setItems([]); setCursor(null); setLoading(false); return () => ac.abort(); }
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      const params = new URLSearchParams(mode === "search" ? { q: query.trim() } : { type: tab === "links" ? "links" : "attachments" });
      if (page) params.set("cursor", page);
      try {
        const res = await fetch(`/api/dm/${conversationId}/${mode === "search" ? "search" : "attachments"}?${params}`, { signal: ac.signal, credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw Error(data.error || "Не удалось загрузить");
        if (ac.signal.aborted) return;
        setItems(prev => page ? [...prev, ...(data.items || [])] : data.items || []); setCursor(data.nextCursor || null);
      } catch (e) { if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "Ошибка сети"); }
      finally { if (!ac.signal.aborted) setLoading(false); }
    }, mode === "search" ? 250 : 0);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [conversationId, mode, tab, query, page, retry]);
  const visible = mode === "search" || tab === "links" ? items : items.filter(i => tab === "media" ? (i.isImage || i.isVideo) && !i.isVoice : tab === "voice" ? i.isVoice : !i.isImage && !i.isVideo && !i.isVoice);
  const jump = (item: Item) => { const id = item.id || item.messageId; if (id) onJump(id); };
  return <aside ref={root} role="dialog" aria-label={mode === "search" ? "Поиск в переписке" : "Материалы чата"} className="absolute right-0 top-0 bottom-0 z-40 w-full sm:w-80 border-l border-[var(--cn-border)] bg-[var(--cn-sidebar)] flex flex-col text-[var(--cn-text)]">
    <div className="p-3 flex items-center justify-between gap-2"><h3 className="font-semibold">{mode === "search" ? "Поиск в переписке" : "Материалы чата"}</h3><button type="button" className="w-11 h-11 rounded-lg hover:bg-[var(--cn-hover)]" onClick={onClose} aria-label="Закрыть панель"><X size={18} className="mx-auto"/></button></div>
    {mode === "search" ? <label className="mx-4 flex items-center gap-2 rounded-lg border border-[var(--cn-border)] px-3"><Search size={17}/><input value={query} maxLength={200} onChange={e => { setQuery(e.target.value); setPage(null); setItems([]); setCursor(null); }} placeholder="От 2 символов…" aria-label="Поиск по всей переписке" className="min-w-0 flex-1 bg-transparent py-3 outline-none"/></label> : <div className="flex border-b border-[var(--cn-border)] px-2" role="tablist" aria-label="Тип материалов">{[["media","Медиа"],["files","Файлы"],["voice","Голос"],["links","Ссылки"]].map(([value,label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => { setTab(value); setPage(null); setItems([]); setCursor(null); }} className={`min-h-11 flex-1 text-sm border-b-2 ${tab === value ? "border-violet-500 text-violet-600 dark:text-cyan-300" : "border-transparent text-[var(--cn-muted)]"}`}>{label}</button>)}</div>}
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3" aria-live="polite">
      {mode === "search" && query.trim().length < 2 && <p className="text-sm text-[var(--cn-muted)]">Поиск по всей обычной переписке с этим собеседником.</p>}
      {visible.map((i,index) => <article key={`${i.id || i.messageId}-${index}`} className="rounded-lg border border-[var(--cn-border)] p-3 break-words">
        {mode === "search" ? <button type="button" onClick={() => jump(i)} className="text-left text-sm min-h-11 w-full whitespace-pre-wrap">{i.content?.slice(0, 350)}</button> : <>
          <div className="flex items-center gap-2 text-sm"><FileText size={18} className="shrink-0"/><span className="min-w-0 flex-1 break-all">{i.name || "Файл"}</span></div>
          {i.isE2EE || i.e2eeIv ? <p className="text-xs mt-2">Защищённое вложение: просмотр здесь недоступен.</p> : <>
            {tab === "media" && i.isImage && i.url && <a href={i.url} target="_blank" rel="noopener noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={i.url} alt={i.name || "Фото"} loading="lazy" className="mt-2 rounded-lg max-h-44 w-full object-contain"/></a>}
            {tab === "media" && i.isVideo && <video src={i.url} controls preload="none" className="mt-2 max-w-full"/>}
            {i.isVoice && <audio src={i.url} controls preload="none" className="mt-2 w-full"/>}
            <a href={i.url} target="_blank" rel="noopener noreferrer" className="min-h-11 flex items-center gap-2 text-sm text-violet-600 dark:text-cyan-300"><Download size={16}/>{tab === "links" ? "Открыть ссылку" : "Открыть файл"}</a>
          </>}
        </>}
        <p className="text-xs text-[var(--cn-muted)] mt-2">{i.user?.name || i.userName} · {new Date(i.createdAt).toLocaleDateString("ru-RU")}</p>
        <button type="button" onClick={() => jump(i)} className="min-h-11 text-sm flex items-center gap-2 text-violet-600 dark:text-cyan-300"><ArrowUpRight size={15}/>К сообщению</button>
      </article>)}
      {!loading && !error && !visible.length && (mode !== "search" || query.trim().length >= 2) && <p className="text-sm text-[var(--cn-muted)]">{cursor ? "На этой странице нет материалов выбранного типа. Загрузите следующую." : "Ничего не найдено"}</p>}
      {error && <div role="alert" className="text-sm text-red-600 dark:text-red-300">{error}<button type="button" className="block min-h-11 underline" onClick={() => setRetry(v => v + 1)}>Повторить</button></div>}
      {loading && <p className="text-sm text-[var(--cn-muted)]">Загрузка…</p>}
      {cursor && !error && <button type="button" disabled={loading} className="w-full min-h-11 rounded-lg border border-[var(--cn-border)] text-sm disabled:opacity-50" onClick={() => setPage(cursor)}>Показать ещё</button>}
    </div>
  </aside>;
}
