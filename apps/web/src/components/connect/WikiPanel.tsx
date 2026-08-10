"use client";

import { useState, useEffect, useCallback } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { ModuleSettingsButton } from "./ModuleSettingsModal";
import { BookIcon, FolderOpenIcon } from "@/components/ui/ConnectIconsExtra";
import { BookOpenIcon, XIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS
import { renderContent } from "./messageFormat"; // FIX-LINKS: кликабельные ссылки в статьях и определениях

type WikiAuthor = { id: string; name: string; username: string };
// FIX-WIKI: у статьи появились «полка» (collectionId) и флаг «только модератор+» (restricted)
type WikiListItem = { id: string; title: string; term?: string | null; slug: string; category: string; restricted?: boolean; collectionId?: string | null; updatedAt: string; updatedBy: WikiAuthor | null };
type WikiArticleFull = WikiListItem & { content: string };
type WikiRevisionItem = { id: string; content: string; createdAt: string; editor: WikiAuthor | null };
// FIX-WIKI: «полка» — группа статей (GROUP) или словарь (DICTIONARY)
type WikiShelf = { id: string; name: string; kind: string; restricted: boolean };

// FIX-WIKI: маленький замочек для скрытых статей и полок
function LockGlyph({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}

export default function WikiPanel({ channelId, channelName, canModerate, onBack }: { channelId: string; channelName: string; currentUserId?: string; canModerate?: boolean; onBack?: () => void }) {
  const [articles, setArticles] = useState<WikiListItem[]>([]);
  const [shelves, setShelves] = useState<WikiShelf[]>([]); // FIX-WIKI
  const [serverMod, setServerMod] = useState(false); // FIX-WIKI: модератор и старше (ответ сервера)
  const [canEdit, setCanEdit] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState<WikiArticleFull | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", term: "", category: "", content: "", collectionId: "", restricted: false });
  const [revisions, setRevisions] = useState<WikiRevisionItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"articles" | "glossary">("articles");
  // FIX-WIKI: состояние полок
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [shelfCreator, setShelfCreator] = useState(false);
  const [shelfDraft, setShelfDraft] = useState({ name: "", kind: "GROUP", restricted: false });
  const [shelfBusy, setShelfBusy] = useState(false);
  const [glossaryShelf, setGlossaryShelf] = useState<string>("all"); // FIX-WIKI: выбранный словарь

  const isMod = serverMod || !!canModerate;

  const fetchList = useCallback(async () => {
    const params = new URLSearchParams({ channelId });
    if (query.trim()) params.set("q", query.trim());
    const res = await fetch("/api/wiki?" + params.toString());
    if (!res.ok) {
      // ФИКС: ошибка загрузки списка больше не проглатывается молча — причина видна в интерфейсе
      const data = await res.json().catch(() => ({} as { error?: string }));
      setError(data.error || "Не удалось загрузить базу знаний");
      return;
    }
    const data = await res.json();
    setArticles(data.articles || []);
    setShelves(data.collections || []); // FIX-WIKI
    setServerMod(!!data.canModerate); // FIX-WIKI
    setCanEdit(!!data.canEdit);
  }, [channelId, query]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const openArticle = useCallback(async (id: string) => {
    setSelectedId(id); setEditing(false); setRevisions(null); setLoading(true);
    const res = await fetch("/api/wiki/" + id);
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setCurrent(data.article);
    setCanEdit(!!data.canEdit);
  }, []);

  const startCreate = () => {
    setSelectedId(null); setCurrent(null); setRevisions(null); setEditing(true); setError("");
    // FIX-WIKI: если открыт конкретный словарь — новый термин сразу попадает в него
    const preset = mode === "glossary" && glossaryShelf !== "all" ? glossaryShelf : "";
    setDraft({ title: "", term: "", category: "", content: "", collectionId: preset, restricted: false });
  };
  const startEdit = () => {
    if (!current) return;
    setEditing(true); setError("");
    setDraft({ title: current.title, term: current.term || "", category: current.category, content: current.content, collectionId: current.collectionId || "", restricted: !!current.restricted });
  };

  const save = async () => {
    // ФИКС: для термина словаря заголовок автоматически подставляется из поля «Термин»
    const payload = { ...draft, title: draft.title.trim() || draft.term.trim(), collectionId: draft.collectionId || null /* FIX-WIKI */ };
    if (!payload.title) return;
    setLoading(true);
    setError("");
    let res;
    try {
      if (selectedId) {
        res = await fetch("/api/wiki/" + selectedId, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else {
        res = await fetch("/api/wiki", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId, ...payload }) });
      }
    } catch {
      // ФИКС: сбой сети больше не оставляет кнопку «Сохранить» заблокированной
      setLoading(false);
      setError("Сеть недоступна. Попробуйте ещё раз.");
      return;
    }
    setLoading(false);
    if (!res.ok) {
      // ФИКС БАГА: раньше ошибка сервера молча проглатывалась (if (!res.ok) return;),
      // из-за чего казалось, что создание статей и словаря просто не работает.
      const data = await res.json().catch(() => ({} as { error?: string }));
      setError(data.error || "Не удалось сохранить статью. Попробуйте ещё раз.");
      return;
    }
    const data = await res.json();
    setEditing(false);
    await fetchList();
    if (data.article?.id) await openArticle(data.article.id);
  };

  const remove = async () => {
    if (!selectedId || !(await confirmDialog({ message: "Удалить статью?", confirmText: "Удалить", danger: true }))) return;
    setError("");
    const res = await fetch("/api/wiki/" + selectedId, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({} as { error?: string }));
      setError(data.error || "Не удалось удалить статью");
      return;
    }
    setSelectedId(null); setCurrent(null); setEditing(false);
    await fetchList();
  };

  const loadRevisions = async () => {
    if (!selectedId) return;
    const res = await fetch("/api/wiki/" + selectedId + "/revisions");
    if (!res.ok) return;
    const data = await res.json();
    setRevisions(data.revisions || []);
  };

  // FIX-WIKI: действия с полками
  const createShelf = async () => {
    const name = shelfDraft.name.trim();
    if (!name) return;
    setShelfBusy(true); setError("");
    try {
      const res = await fetch("/api/wiki/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId, name, kind: shelfDraft.kind, restricted: shelfDraft.restricted }) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }));
        setError(d.error || "Не удалось создать полку");
      } else {
        setShelfCreator(false);
        setShelfDraft({ name: "", kind: "GROUP", restricted: false });
        await fetchList();
      }
    } catch { setError("Сеть недоступна. Попробуйте ещё раз."); }
    setShelfBusy(false);
  };

  const toggleShelfLock = async (s: WikiShelf) => {
    setError("");
    const res = await fetch("/api/wiki/collections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, restricted: !s.restricted }) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }));
      setError(d.error || "Не удалось изменить полку");
      return;
    }
    await fetchList();
  };

  const removeShelf = async (s: WikiShelf) => {
    if (!(await confirmDialog({ message: `Удалить полку «${s.name}»? Статьи останутся, но окажутся вне полки.`, confirmText: "Удалить", danger: true }))) return;
    setError("");
    const res = await fetch("/api/wiki/collections?id=" + s.id, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }));
      setError(d.error || "Не удалось удалить полку");
      return;
    }
    if (glossaryShelf === s.id) setGlossaryShelf("all");
    await fetchList();
  };

  // FIX-WIKI: раскладка статей: по полкам, затем старые категории для статей без полки
  const shelfArticles = (id: string) => articles.filter(a => a.collectionId === id);
  const looseArticles = articles.filter(a => !a.collectionId);
  const categories = Array.from(new Set(looseArticles.map(a => a.category).filter(Boolean))).sort();
  const grouped = (cat: string) => looseArticles.filter(a => (a.category || "") === cat);
  const uncategorized = looseArticles.filter(a => !a.category);
  const dictionaries = shelves.filter(s => s.kind === "DICTIONARY");
  const glossaryEntries = articles.filter(a => a.term && (glossaryShelf === "all" || a.collectionId === glossaryShelf));
  const currentShelf = current?.collectionId ? shelves.find(s => s.id === current.collectionId) : undefined;

  const articleRow = (a: WikiListItem) => (
    <button key={a.id} onClick={() => openArticle(a.id)}
      className={"w-full flex items-center gap-1.5 text-left px-2 py-1.5 rounded-lg text-sm " + (selectedId === a.id ? "bg-neutral-200 dark:bg-white/10" : "hover:bg-neutral-100 dark:hover:bg-white/5")}>
      <span className="flex-1 min-w-0 truncate">{a.title}</span>
      {a.restricted && <span className="flex-shrink-0 text-amber-500" title="Видно только модераторам и старше"><LockGlyph /></span>}
    </button>
  );

  /* MOBILE-FIX: на телефоне «База знаний» — два экрана вместо двух колонок:
     список статей на всю ширину, при выборе статьи открывается её текст с
     кнопкой «к списку». Раньше боковая колонка 256px + main рядом не влезали
     в 360dp — интерфейс выглядел сдвинутым и обрезанным. */
  const mobileShowArticle = !!(selectedId || editing);

  return (
    <div className="flex h-full min-h-0">
      <aside className={`w-64 max-md:w-full flex-shrink-0 border-r border-neutral-200 dark:border-white/10 flex flex-col min-h-0 ${mobileShowArticle ? "max-md:hidden" : ""}`}>
        <div className="p-3 border-b border-neutral-200 dark:border-white/10">
          {onBack && (
            <button onClick={onBack} className="md:hidden -ml-2 mb-1 min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-neutral-500 active:text-neutral-800 dark:active:text-white" aria-label="Открыть каналы">
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h16" /></svg>
            </button>
          )}
          <div className="flex items-center gap-2 font-semibold text-neutral-800 dark:text-gray-100">
            <BookIcon size={18} />
            <span className="flex-1 min-w-0 truncate">{channelName}</span>
            {canModerate && <ModuleSettingsButton channelId={channelId} />}
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-neutral-100 dark:bg-white/5 p-0.5 text-xs">
            <button onClick={() => setMode("articles")} className={`flex-1 px-2 py-1 rounded-md ${mode === "articles" ? "bg-emerald-500 text-white" : "text-neutral-500 dark:text-gray-400"}`}>Статьи</button>
            <button onClick={() => setMode("glossary")} className={`flex-1 px-2 py-1 rounded-md ${mode === "glossary" ? "bg-emerald-500 text-white" : "text-neutral-500 dark:text-gray-400"}`}>Словарь</button>
          </div>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск…"
            className="mt-2 w-full text-sm px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-white/5 outline-none" />
          {(canEdit || canModerate) && <button onClick={startCreate} className="mt-2 w-full text-sm px-2 py-1.5 rounded-lg bg-violet-600 dark:bg-cyan-500 text-white">{mode === "glossary" ? "+ Новый термин" : "+ Новая статья"}</button>}
          {/* FIX-WIKI: создание полок — групп статей и словарей */}
          {(canEdit || isMod) && (
            <button onClick={() => setShelfCreator(v => !v)}
              className="mt-1.5 w-full text-xs px-2 py-1.5 rounded-lg border border-dashed border-neutral-300 dark:border-white/15 text-neutral-500 dark:text-neutral-400 hover:border-violet-400 dark:hover:border-cyan-400 hover:text-violet-600 dark:hover:text-cyan-400 transition-colors">
              {shelfCreator ? "Отмена" : "+ Полка: группа или словарь"}
            </button>
          )}
          {shelfCreator && (
            <div className="mt-2 p-2.5 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 space-y-2">
              <input value={shelfDraft.name} onChange={e => setShelfDraft({ ...shelfDraft, name: e.target.value })} placeholder="Название полки…" maxLength={80}
                className="w-full text-sm px-2 py-1.5 rounded-lg bg-white dark:bg-white/10 border border-neutral-200 dark:border-white/10 outline-none" />
              <div className="flex items-center gap-1 rounded-lg bg-neutral-200/60 dark:bg-white/10 p-0.5 text-xs">
                <button onClick={() => setShelfDraft({ ...shelfDraft, kind: "GROUP" })} className={`flex-1 px-2 py-1 rounded-md inline-flex items-center justify-center gap-1 ${shelfDraft.kind === "GROUP" ? "bg-violet-500 dark:bg-cyan-500 text-white dark:text-neutral-900" : "text-neutral-500 dark:text-gray-400"}`}><BookIcon size={12} style={{ color: "inherit" }} /> Группа</button>
                <button onClick={() => setShelfDraft({ ...shelfDraft, kind: "DICTIONARY" })} className={`flex-1 px-2 py-1 rounded-md inline-flex items-center justify-center gap-1 ${shelfDraft.kind === "DICTIONARY" ? "bg-violet-500 dark:bg-cyan-500 text-white dark:text-neutral-900" : "text-neutral-500 dark:text-gray-400"}`}><BookOpenIcon size={12} style={{ color: "inherit" }} /> Словарь</button>
              </div>
              {isMod && (
                <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none">
                  <input type="checkbox" checked={shelfDraft.restricted} onChange={e => setShelfDraft({ ...shelfDraft, restricted: e.target.checked })} className="w-3.5 h-3.5 accent-amber-500" />
                  <span className="flex items-center gap-1"><span className="text-amber-500"><LockGlyph /></span> Только модератор и старше</span>
                </label>
              )}
              <button onClick={createShelf} disabled={shelfBusy || !shelfDraft.name.trim()} className="w-full text-xs px-2 py-1.5 rounded-lg bg-violet-600 dark:bg-cyan-500 text-white disabled:opacity-50">{shelfBusy ? "…" : "Создать полку"}</button>
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-3">
          {mode === "glossary" ? (
            /* FIX-WIKI: в режиме словаря слева — список словарей */
            <div className="space-y-1">
              <button onClick={() => setGlossaryShelf("all")}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm text-left ${glossaryShelf === "all" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium" : "hover:bg-neutral-100 dark:hover:bg-white/5 text-neutral-700 dark:text-gray-300"}`}>
                <BookOpenIcon size={13} style={{ color: "inherit" }} />
                <span className="flex-1 min-w-0 truncate">Все термины</span>
                <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-200/70 dark:bg-white/10 text-neutral-500 dark:text-neutral-400">{articles.filter(a => a.term).length}</span>
              </button>
              {dictionaries.map(s => (
                <div key={s.id} className="group/shelf flex items-center gap-0.5">
                  <button onClick={() => setGlossaryShelf(s.id)}
                    className={`flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm text-left ${glossaryShelf === s.id ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium" : "hover:bg-neutral-100 dark:hover:bg-white/5 text-neutral-700 dark:text-gray-300"}`}>
                    <BookOpenIcon size={13} style={{ color: "inherit" }} />
                    <span className="flex-1 min-w-0 truncate">{s.name}</span>
                    {s.restricted && <span className="flex-shrink-0 text-amber-500" title="Видно только модераторам и старше"><LockGlyph /></span>}
                    <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-200/70 dark:bg-white/10 text-neutral-500 dark:text-neutral-400">{shelfArticles(s.id).filter(a => a.term).length}</span>
                  </button>
                  {isMod && (
                    <span className="hidden group-hover/shelf:flex items-center flex-shrink-0">
                      <button onClick={() => toggleShelfLock(s)} title={s.restricted ? "Открыть всем участникам" : "Скрыть от участников"} className={`p-1 rounded ${s.restricted ? "text-amber-500" : "text-neutral-400 hover:text-amber-500"}`}><LockGlyph size={12} /></button>
                      <button onClick={() => removeShelf(s)} title="Удалить словарь" className="p-1 rounded text-neutral-400 hover:text-red-500 leading-none"><XIcon size={11} style={{ color: "inherit" }} /></button>
                    </span>
                  )}
                </div>
              ))}
              {dictionaries.length === 0 && <p className="text-xs text-neutral-400 px-2">Словарей пока нет — создайте полку «Словарь».</p>}
            </div>
          ) : (
            <>
              {/* FIX-WIKI: полки — группы статей и словари */}
              {shelves.map(s => {
                const items = shelfArticles(s.id);
                const closedShelf = collapsed[s.id];
                return (
                  <div key={s.id}>
                    <div className={`group/shelf flex items-center gap-1 pl-2 pr-1 py-1.5 rounded-lg border-l-2 bg-gradient-to-r to-transparent ${s.restricted ? "border-amber-400 from-amber-500/10" : "border-violet-400 dark:border-cyan-400 from-violet-500/10 dark:from-cyan-500/10"}`}>
                      <button onClick={() => setCollapsed(c => ({ ...c, [s.id]: !c[s.id] }))} className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
                        <span className="text-[10px] text-neutral-400 w-3 flex-shrink-0">{closedShelf ? "▸" : "▾"}</span>
                        <span className="flex-shrink-0 inline-flex items-center">{s.kind === "DICTIONARY" ? <BookOpenIcon size={13} style={{ color: "inherit" }} /> : <BookIcon size={13} style={{ color: "inherit" }} />}</span>
                        <span className="flex-1 min-w-0 truncate text-sm font-medium text-neutral-800 dark:text-gray-100">{s.name}</span>
                        {s.restricted && <span className="flex-shrink-0 text-amber-500" title="Видно только модераторам и старше"><LockGlyph /></span>}
                        <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-200/70 dark:bg-white/10 text-neutral-500 dark:text-neutral-400">{items.length}</span>
                      </button>
                      {isMod && (
                        <span className="hidden group-hover/shelf:flex items-center flex-shrink-0">
                          <button onClick={() => toggleShelfLock(s)} title={s.restricted ? "Открыть всем участникам" : "Скрыть от участников"} className={`p-1 rounded ${s.restricted ? "text-amber-500" : "text-neutral-400 hover:text-amber-500"}`}><LockGlyph size={12} /></button>
                          <button onClick={() => removeShelf(s)} title="Удалить полку" className="p-1 rounded text-neutral-400 hover:text-red-500 leading-none"><XIcon size={11} style={{ color: "inherit" }} /></button>
                        </span>
                      )}
                    </div>
                    {!closedShelf && (
                      <div className="ml-3 pl-1 border-l border-neutral-200 dark:border-white/10 mt-0.5 space-y-0.5">
                        {items.map(a => articleRow(a))}
                        {items.length === 0 && <p className="text-xs text-neutral-400 px-2 py-1">Пусто</p>}
                      </div>
                    )}
                  </div>
                );
              })}
              {categories.map(cat => (
                <div key={cat}>
                  <div className="text-xs uppercase tracking-wide text-neutral-400 px-2 mb-1">{cat}</div>
                  {grouped(cat).map(a => articleRow(a))}
                </div>
              ))}
              {uncategorized.length > 0 && (
                <div>
                  {(categories.length > 0 || shelves.length > 0) && <div className="text-xs uppercase tracking-wide text-neutral-400 px-2 mb-1">Без полки</div>}
                  {uncategorized.map(a => articleRow(a))}
                </div>
              )}
              {articles.length === 0 && shelves.length === 0 && <div className="text-sm text-neutral-400 px-2">Статей пока нет.</div>}
            </>
          )}
        </nav>
      </aside>

      <main className={`flex-1 min-w-0 overflow-y-auto p-6 max-md:p-4 ${mobileShowArticle ? "" : "max-md:hidden"}`}>
        {/* MOBILE-FIX: возврат к списку статей (мобильный экран) */}
        {mobileShowArticle && (
          <button
            onClick={() => { setSelectedId(null); setCurrent(null); setEditing(false); }}
            className="md:hidden -ml-2 mb-3 min-h-[44px] inline-flex items-center gap-1.5 px-2 text-sm font-medium text-violet-600 dark:text-cyan-400 active:opacity-60"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M15 19l-7-7 7-7" /></svg>
            К списку
          </button>
        )}
        {(!editing && mode === "glossary") ? (
          <GlossaryView entries={glossaryEntries} query={query} />
        ) : editing ? (
          <div className="max-w-3xl mx-auto space-y-3">
            <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Заголовок (для термина словаря можно не заполнять)"
              className="w-full text-2xl font-bold bg-transparent outline-none border-b border-neutral-200 dark:border-white/10 pb-2" />
            <input value={draft.term} onChange={e => setDraft({ ...draft, term: e.target.value })} placeholder="Термин (для режима «Словарь», необязательно)"
              className="w-full text-sm px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 outline-none" />
            <input value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} placeholder="Категория (необязательно)"
              className="w-full text-sm px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-white/5 outline-none" />
            {/* FIX-WIKI: выбор полки и ограничение видимости */}
            <div className="flex flex-wrap items-center gap-2">
              <select value={draft.collectionId} onChange={e => setDraft({ ...draft, collectionId: e.target.value })}
                className="text-sm px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 outline-none">
                <option value="">Без полки</option>
                {/* FIX-ICONS: <option> не рендерит разметку — вместо эмодзи текстовые пометки */}
                {shelves.map(s => (
                  <option key={s.id} value={s.id}>{(s.kind === "DICTIONARY" ? "Словарь: " : "Полка: ") + s.name + (s.restricted ? " (модератор+)" : "")}</option>
                ))}
              </select>
              {isMod && (
                <label className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer select-none transition-colors ${draft.restricted ? "border-amber-400 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-neutral-200 dark:border-white/10 text-neutral-500"}`}>
                  <input type="checkbox" checked={draft.restricted} onChange={e => setDraft({ ...draft, restricted: e.target.checked })} className="w-3.5 h-3.5 accent-amber-500" />
                  <LockGlyph /> Только модератор и старше
                </label>
              )}
            </div>
            <textarea value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} placeholder="Текст статьи (Markdown)…"
              className="w-full h-[50vh] text-sm px-3 py-2 rounded-lg bg-neutral-100 dark:bg-white/5 outline-none font-mono resize-none" />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={loading || (!draft.title.trim() && !draft.term.trim())} className="px-4 py-2 rounded-lg bg-violet-600 dark:bg-cyan-500 text-white text-sm disabled:opacity-50">Сохранить</button>
              <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg bg-neutral-200 dark:bg-white/10 text-sm">Отмена</button>
            </div>
          </div>
        ) : current ? (
          <article className="max-w-3xl mx-auto">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-3xl font-bold text-neutral-900 dark:text-gray-50">{current.title}</h1>
              {canEdit && (
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={startEdit} className="px-3 py-1.5 rounded-lg bg-neutral-200 dark:bg-white/10 text-sm">Править</button>
                  <button onClick={remove} className="px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-600 text-sm">Удалить</button>
                </div>
              )}
            </div>
            <div className="text-xs text-neutral-400 mt-1 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* FIX-WIKI: бейджи полки и ограничения видимости */}
              {current.restricted && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400"><LockGlyph /> модератор+</span>
              )}
              {currentShelf && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-white/5">{currentShelf.kind === "DICTIONARY" ? <BookOpenIcon size={12} style={{ color: "inherit" }} /> : <BookIcon size={12} style={{ color: "inherit" }} />} {currentShelf.name}</span>
              )}
              {current.category && <span><FolderOpenIcon size={12} /> {current.category}</span>}
              <span>
                {current.updatedBy && <span>ред. {current.updatedBy.name} · </span>}
                {new Date(current.updatedAt).toLocaleString()}
              </span>
              <button onClick={loadRevisions} className="underline hover:text-neutral-600">История</button>
            </div>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap text-neutral-800 dark:text-gray-200">{current.content ? renderContent(current.content) : "(пусто)"}</div>
            {revisions && (
              <div className="mt-8 border-t border-neutral-200 dark:border-white/10 pt-4">
                <h3 className="font-semibold mb-2 text-sm">История правок ({revisions.length})</h3>
                <ul className="space-y-2">
                  {revisions.map(r => (
                    <li key={r.id} className="text-xs text-neutral-500">
                      {new Date(r.createdAt).toLocaleString()} {r.editor ? "· " + r.editor.name : ""}
                    </li>
                  ))}
                  {revisions.length === 0 && <li className="text-xs text-neutral-400">Правок ещё не было.</li>}
                </ul>
              </div>
            )}
          </article>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-neutral-400 text-sm">
            {error && <p className="text-red-500">{error}</p>}
            <span>{loading ? "Загрузка…" : "Выберите статью слева"}</span>
          </div>
        )}
      </main>
    </div>
  );
}

function GlossaryView({ entries, query }: { entries: { id: string; term?: string | null; title: string; restricted?: boolean }[]; query: string }) {
  const [open, setOpen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = entries
    .filter(e => (e.term || "").toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (a.term || "").localeCompare(b.term || "", "ru"));

  const groups: Record<string, typeof filtered> = {};
  for (const e of filtered) {
    const letter = (e.term || "#").charAt(0).toUpperCase();
    (groups[letter] = groups[letter] || []).push(e);
  }
  const letters = Object.keys(groups).sort((a, b) => a.localeCompare(b, "ru"));

  const toggle = async (id: string) => {
    if (open[id] !== undefined) { setOpen(o => { const n = { ...o }; delete n[id]; return n; }); return; }
    setBusy(id);
    try {
      const res = await fetch("/api/wiki/" + id);
      if (res.ok) { const d = await res.json(); setOpen(o => ({ ...o, [id]: (d.article?.content || d.content || "") })); }
    } finally { setBusy(null); }
  };

  if (filtered.length === 0) {
    return <div className="max-w-3xl mx-auto text-center text-neutral-400 mt-12"><div className="mb-2"><BookIcon size={36} /></div><p>{query ? "Терминов не найдено" : "Словарь пуст. Создайте статью и заполните поле «Термин»."}</p></div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-wrap gap-1 mb-4 sticky top-0 bg-white dark:bg-neutral-900 py-2">
        {letters.map(l => (<a key={l} href={"#gl-" + l} className="w-7 h-7 flex items-center justify-center rounded text-xs font-semibold bg-neutral-100 dark:bg-white/5 hover:bg-emerald-500 hover:text-white">{l}</a>))}
      </div>
      {letters.map(l => (
        <div key={l} id={"gl-" + l} className="mb-5">
          <div className="text-xs font-bold text-emerald-500 mb-1.5">{l}</div>
          <div className="space-y-1.5">
            {groups[l].map(e => (
              <div key={e.id} className="rounded-lg border border-neutral-200 dark:border-white/10 overflow-hidden">
                <button onClick={() => toggle(e.id)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-white/5">
                  <span className="font-semibold flex items-center gap-1.5">{e.term}{e.restricted && <span className="text-amber-500" title="Видно только модераторам и старше"><LockGlyph /></span>}</span>
                  <span className="text-neutral-400 text-sm">{busy === e.id ? "…" : (open[e.id] !== undefined ? "−" : "+")}</span>
                </button>
                {open[e.id] !== undefined && (
                  <div className="px-3 pb-3 pt-1 text-sm text-neutral-700 dark:text-gray-300 whitespace-pre-wrap border-t border-neutral-100 dark:border-white/5">{open[e.id] ? renderContent(open[e.id]) : "(определение пусто)"}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
