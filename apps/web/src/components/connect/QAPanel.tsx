"use client";

import { useState, useCallback, useEffect } from "react";
import { ModuleSettingsButton } from "@/components/connect/ModuleSettingsModal"; // FIX-QAGEAR
import { QuestionIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS
import { renderContent } from "./messageFormat"; // FIX-LINKS: кликабельные ссылки в вопросах и ответах


/* ─── Types ─── */
interface QAAuthor { id: string; name: string; username?: string; avatar: string | null }
interface QAThreadListItem {
  id: string;
  title: string;
  body: string;
  status: string;
  tags: string;
  acceptedAnswerId: string | null;
  createdAt: string;
  author: QAAuthor;
  _count: { answers: number; votes: number };
}
interface QAAnswerItem {
  id: string;
  body: string;
  createdAt: string;
  author: QAAuthor;
  _count: { votes: number };
}
interface QAThreadDetail extends QAThreadListItem {
  answers: QAAnswerItem[];
}
type MyVote = { threadId: string | null; answerId: string | null };
/* FIX-QAACL: права приходят с сервера вместе со списком вопросов. Кнопки и
   форма ответа скрываются, но окончательное решение всё равно за API. */
interface QAPermissions { canAsk: boolean; canAnswer: boolean; canModerate: boolean }

interface QAPanelProps {
  channelId: string;
  channelName: string;
  currentUserId: string;
  canModerate: boolean;
  onBack?: () => void;
}

export default function QAPanel({ channelId, channelName, currentUserId, canModerate, onBack }: QAPanelProps) {
  const [threads, setThreads] = useState<QAThreadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"new" | "top">("new");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">("all");
  const [showAsk, setShowAsk] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [perms, setPerms] = useState<QAPermissions>({ canAsk: true, canAnswer: true, canModerate: false });

  const fetchThreads = useCallback(() => {
    setLoading(true);
    fetch(`/api/qa?channelId=${channelId}&sort=${sort}&status=${statusFilter}`)
      .then((r) => r.json())
      .then((d) => {
        setThreads(Array.isArray(d.threads) ? d.threads : []);
        if (d.permissions) {
          setPerms({
            canAsk: d.permissions.canAsk !== false,
            canAnswer: d.permissions.canAnswer !== false,
            canModerate: d.permissions.canModerate === true,
          });
        }
      })
      .catch(() => setThreads([]))
      .finally(() => setLoading(false));
  }, [channelId, sort, statusFilter]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-white/10">
        {onBack && (
          <button onClick={onBack} className="md:hidden -ml-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-neutral-500 active:text-neutral-800 dark:active:text-white" aria-label="Открыть каналы">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h16" /></svg>
          </button>
        )}
        <QuestionIcon size={18} />
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white flex-1 truncate">{channelName}</h2>
        {/* FIX-QAGEAR: настройки раздела (кто видит и кто пишет) — как в
            остальных модулях; доступны модерации. */}
        {canModerate && <ModuleSettingsButton channelId={channelId} onSaved={fetchThreads} />}
        {perms.canAsk && (
          <button onClick={() => setShowAsk(true)} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white transition-colors">
            Задать вопрос
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-neutral-100 dark:border-white/5 text-xs">
        <select value={sort} onChange={(e) => setSort(e.target.value as "new" | "top")} className="bg-neutral-100 dark:bg-neutral-800 rounded px-2 py-1 text-neutral-700 dark:text-neutral-200">
          <option value="new">Новые</option>
          <option value="top">Популярные</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | "open" | "resolved")} className="bg-neutral-100 dark:bg-neutral-800 rounded px-2 py-1 text-neutral-700 dark:text-neutral-200">
          <option value="all">Все</option>
          <option value="open">Открытые</option>
          <option value="resolved">Решённые</option>
        </select>
        <span className="ml-auto text-neutral-400">{threads.length} вопрос(ов)</span>
      </div>

      {/* Accordion list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <p className="text-center text-sm text-neutral-400 py-8">Загрузка…</p>
        ) : threads.length === 0 ? (
          <p className="text-center text-sm text-neutral-400 py-8">
            {perms.canAsk ? "Пока нет вопросов. Будьте первым!" : "Пока нет вопросов."}
          </p>
        ) : (
          threads.map((t) => (
            <QACard
              key={t.id}
              thread={t}
              open={openId === t.id}
              onToggle={() => setOpenId(openId === t.id ? null : t.id)}
              currentUserId={currentUserId}
              canModerate={canModerate}
              canAnswer={perms.canAnswer}
              onChanged={fetchThreads}
            />
          ))
        )}
      </div>

      {showAsk && (
        <QAAskModal channelId={channelId} onClose={() => setShowAsk(false)} onCreated={() => { setShowAsk(false); fetchThreads(); }} />
      )}
    </div>
  );
}

/* ─── Question Card (accordion) ─── */
function QACard({ thread, open, onToggle, currentUserId, canModerate, canAnswer, onChanged }: {
  thread: QAThreadListItem;
  open: boolean;
  onToggle: () => void;
  currentUserId: string;
  canModerate: boolean;
  /** FIX-QAACL: право отвечать в этом разделе. */
  canAnswer: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<QAThreadDetail | null>(null);
  const [myVotes, setMyVotes] = useState<MyVote[]>([]);
  const [loading, setLoading] = useState(false);
  const [answerBody, setAnswerBody] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/qa/${thread.id}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d.thread || null); setMyVotes(d.myVotes || []); })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [thread.id]);

  useEffect(() => { if (open && !detail) load(); }, [open, detail, load]);

  const votedThread = myVotes.some((v) => v.threadId === thread.id);
  const votedAnswer = (aid: string) => myVotes.some((v) => v.answerId === aid);

  const vote = async (payload: { threadId?: string; answerId?: string }) => {
    await fetch("/api/qa/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    load(); onChanged();
  };
  const accept = async (answerId: string) => {
    const newId = detail?.acceptedAnswerId === answerId ? null : answerId;
    await fetch(`/api/qa/${thread.id}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answerId: newId }) });
    load(); onChanged();
  };
  const [answerError, setAnswerError] = useState("");
  const postAnswer = async () => {
    if (!answerBody.trim()) return;
    setPosting(true); setAnswerError("");
    const res = await fetch(`/api/qa/${thread.id}/answers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: answerBody }) }).catch(() => null);
    setPosting(false);
    if (!res || !res.ok) {
      const d = res ? await res.json().catch(() => ({})) : {};
      setAnswerError(d.error || "Не удалось отправить ответ");
      return;
    }
    setAnswerBody("");
    load(); onChanged();
  };

  const canAccept = canModerate || thread.author.id === currentUserId;
  const answers = detail?.answers || [];

  return (
    <div className={`rounded-xl border transition-colors ${open ? "border-violet-300 dark:border-cyan-500/40 bg-white dark:bg-neutral-800/60" : "border-neutral-200 dark:border-white/5 bg-neutral-50 dark:bg-neutral-800/40 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
      {/* Question header (click to expand) */}
      <button onClick={onToggle} className="w-full text-left p-3">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center justify-center min-w-[44px] text-center">
            <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">{thread._count.votes}</span>
            <span className="text-[10px] text-neutral-400">голосов</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {thread.status === "RESOLVED" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-500 font-medium">Решён</span>
              )}
              <span className="text-sm font-medium text-neutral-900 dark:text-white truncate">{thread.title}</span>
            </div>
            {!open && <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">{thread.body}</p>}
            <div className="flex items-center gap-2 mt-1.5 text-[11px] text-neutral-400">
              <span>{thread.author.name}</span>
              <span>·</span>
              <span>{thread._count.answers} ответ(ов)</span>
              {thread.tags && thread.tags.split(",").filter(Boolean).map((tag) => (
                <span key={tag} className="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">{tag.trim()}</span>
              ))}
            </div>
          </div>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
        </div>
      </button>

      {/* Expanded body: full question + answers + composer */}
      {open && (
        <div className="px-3 pb-3 border-t border-neutral-100 dark:border-white/5 pt-3">
          {/* Full question text + upvote */}
          <div className="flex gap-3">
            <button onClick={() => vote({ threadId: thread.id })} className={`flex flex-col items-center gap-0.5 ${votedThread ? "text-violet-600 dark:text-cyan-400" : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"}`}>
              <svg width={20} height={20} viewBox="0 0 24 24" fill={votedThread ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
              <span className="text-sm font-semibold">{detail?._count.votes ?? thread._count.votes}</span>
            </button>
            <p className="flex-1 text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">{renderContent(thread.body)}</p>
          </div>

          {/* Answers */}
          <div className="mt-3">
            <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide">Ответы{loading ? " · …" : " · " + answers.length}</h3>
            {loading ? (
              <p className="text-xs text-neutral-400 py-2">Загрузка…</p>
            ) : answers.length === 0 ? (
              <p className="text-xs text-neutral-400 py-2">
                {canAnswer ? "Ответов пока нет. Ответьте первым!" : "Ответов пока нет."}
              </p>
            ) : (
              <div className="space-y-2">
                {answers.map((a) => {
                  const isAccepted = detail?.acceptedAnswerId === a.id;
                  return (
                    <div key={a.id} className={`flex gap-3 p-3 rounded-lg border ${isAccepted ? "border-green-500/40 bg-green-500/5" : "border-neutral-200 dark:border-white/5 bg-neutral-50 dark:bg-neutral-800/40"}`}>
                      <div className="flex flex-col items-center gap-1">
                        <button onClick={() => vote({ answerId: a.id })} className={`flex flex-col items-center ${votedAnswer(a.id) ? "text-violet-600 dark:text-cyan-400" : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"}`}>
                          <svg width={16} height={16} viewBox="0 0 24 24" fill={votedAnswer(a.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                          <span className="text-xs font-semibold">{a._count.votes}</span>
                        </button>
                        {isAccepted && (
                          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="text-green-500"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">{renderContent(a.body)}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[11px] text-neutral-400">{a.author.name}</span>
                          {canAccept && (
                            <button onClick={() => accept(a.id)} className={`text-[11px] px-2 py-0.5 rounded ${isAccepted ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-green-500/15 hover:text-green-600"}`}>
                              {isAccepted ? "Принят" : "Принять"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Answer composer — FIX-QAACL: только при праве отвечать */}
          {canAnswer ? (
            <div className="mt-3">
              <textarea
                value={answerBody}
                onChange={(e) => setAnswerBody(e.target.value)}
                placeholder="Ваш ответ…"
                rows={2}
                maxLength={8000}
                className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400 resize-none"
              />
              {answerError && <p className="text-xs text-red-500 mt-1">{answerError}</p>}
              <div className="flex justify-end mt-2">
                <button onClick={postAnswer} disabled={posting || !answerBody.trim()} className="px-4 py-1.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white disabled:opacity-50">
                  {posting ? "…" : "Ответить"}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-neutral-400">
              Отвечать в этом разделе могут только участники с нужным тегом или правами.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Ask Question Modal ─── */
function QAAskModal({ channelId, onClose, onCreated }: { channelId: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!title.trim() || !body.trim()) { setError("Заполните заголовок и текст"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, title, body, tags }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Ошибка"); }
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-neutral-900 rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">Новый вопрос</h3>
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок вопроса" maxLength={200} className="w-full mb-3 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Подробно опишите вопрос…" rows={6} maxLength={8000} className="w-full mb-3 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400 resize-none" />
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Теги через запятую (необязательно)" maxLength={200} className="w-full mb-4 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400" />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800">Отмена</button>
          <button onClick={submit} disabled={saving || !title.trim() || !body.trim()} className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white disabled:opacity-50">
            {saving ? "…" : "Опубликовать"}
          </button>
        </div>
      </div>
    </div>
  );
}
