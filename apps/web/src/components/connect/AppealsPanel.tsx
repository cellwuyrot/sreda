"use client";

import { useState, useCallback, useEffect } from "react";

/* ─── Types ─── */
interface AppealAuthor { id: string; name: string; username?: string; avatar: string | null }
interface AppealListItem {
  id: string;
  subject: string;
  body: string;
  category: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  author: AppealAuthor;
  _count: { messages: number };
}
interface AppealMessageItem {
  id: string;
  body: string;
  isAdmin: boolean;
  createdAt: string;
  author: AppealAuthor;
}
interface AppealDetail extends AppealListItem {
  messages: AppealMessageItem[];
}

interface AppealsPanelProps {
  channelId: string;
  channelName: string;
  currentUserId: string;
  canModerate?: boolean;
  onBack?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Открыто",
  IN_PROGRESS: "В работе",
  CLOSED: "Закрыто",
};
const STATUS_TINT: Record<string, string> = {
  OPEN: "#22c55e",
  IN_PROGRESS: "#f59e0b",
  CLOSED: "#64748b",
};

/* Открытая заявка гасит свои уведомления на сервере (см. GET /api/appeals/[id]).
   Счётчик в колокольчике живёт в другом дереве компонентов, поэтому остаток
   непрочитанного передаётся ему тем же событием, которым это делает страница
   уведомлений: иначе цифра осталась бы прежней до перезагрузки, и починка выглядела
   бы как «всё равно не пропало». */
function publishUnread(unreadLeft: unknown) {
  if (typeof unreadLeft !== "number") return;
  window.dispatchEvent(
    new CustomEvent("tz-notifications-read", { detail: { unreadCount: Math.max(0, unreadLeft) } }),
  );
}

export default function AppealsPanel({ channelId, channelName, currentUserId, onBack }: AppealsPanelProps) {
  const [appeals, setAppeals] = useState<AppealListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppealDetail | null>(null);

  // create form state
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // reply state
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const fetchAppeals = useCallback(() => {
    setLoading(true);
    fetch(`/api/appeals?channelId=${channelId}`)
      .then((r) => r.json())
      .then((d) => setAppeals(Array.isArray(d.appeals) ? d.appeals : []))
      .catch(() => setAppeals([]))
      .finally(() => setLoading(false));
  }, [channelId]);

  useEffect(() => { fetchAppeals(); }, [fetchAppeals]);

  const fetchDetail = useCallback((id: string) => {
    fetch(`/api/appeals/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setDetail(d.appeal || null);
        publishUnread(d.unreadLeft);
      })
      .catch(() => setDetail(null));
  }, []);

  useEffect(() => { if (openId) fetchDetail(openId); else setDetail(null); }, [openId, fetchDetail]);

  const submitAppeal = async () => {
    if (!subject.trim() || !body.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, subject, body, category }),
      });
      if (res.ok) {
        setSubject(""); setBody(""); setCategory(""); setShowForm(false);
        fetchAppeals();
      }
    } finally { setSubmitting(false); }
  };

  const sendReply = async () => {
    if (!reply.trim() || !openId || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/appeals/${openId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      if (res.ok) { setReply(""); fetchDetail(openId); }
    } finally { setSending(false); }
  };

  /* ─── Detail / thread view ─── */
  if (openId && detail) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ color: "var(--cn-text)" }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--cn-border)" }}>
          <button onClick={() => setOpenId(null)} className="text-sm opacity-70 hover:opacity-100">← Назад</button>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{detail.subject}</div>
            <div className="text-xs opacity-60">{detail.category || "Без категории"}</div>
          </div>
          <span className="text-xs rounded-full px-2 py-0.5" style={{ background: STATUS_TINT[detail.status] + "22", color: STATUS_TINT[detail.status] }}>
            {STATUS_LABEL[detail.status] || detail.status}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {detail.messages.map((m) => {
            const mine = m.author.id === currentUserId;
            return (
              <div key={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                <div className="max-w-[75%] rounded-2xl px-3 py-2 text-sm" style={{ background: m.isAdmin ? "rgba(37,99,235,0.18)" : "var(--cn-surface-2, rgba(255,255,255,0.06))" }}>
                  <div className="text-[11px] opacity-60 mb-0.5">{m.isAdmin ? "Администратор" : m.author.name}</div>
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                </div>
              </div>
            );
          })}
        </div>
        {detail.status !== "CLOSED" && (
          <div className="p-3 border-t flex gap-2" style={{ borderColor: "var(--cn-border)" }}>
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
              placeholder="Ваш ответ…"
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: "var(--cn-surface-2, rgba(255,255,255,0.06))", color: "var(--cn-text)" }}
            />
            <button onClick={sendReply} disabled={sending || !reply.trim()} className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40" style={{ background: "#2563eb", color: "#fff" }}>Отправить</button>
          </div>
        )}
      </div>
    );
  }

  /* ─── List + create form ─── */
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ color: "var(--cn-text)" }}>
      <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--cn-border)" }}>
        {onBack && (
          <button onClick={onBack} className="md:hidden -ml-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center opacity-70 active:opacity-100" aria-label="Открыть каналы">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h16" /></svg>
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{channelName}</div>
          <div className="text-xs opacity-60">Обращения</div>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="rounded-lg px-3 py-1.5 text-sm font-medium" style={{ background: "#e11d48", color: "#fff" }}>
          {showForm ? "Отмена" : "Новое обращение"}
        </button>
      </div>

      {showForm && (
        <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: "var(--cn-border)" }}>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Тема" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: "var(--cn-surface-2, rgba(255,255,255,0.06))", color: "var(--cn-text)" }} />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Категория (необязательно)" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: "var(--cn-surface-2, rgba(255,255,255,0.06))", color: "var(--cn-text)" }} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Опишите ваше обращение…" rows={4} className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none" style={{ background: "var(--cn-surface-2, rgba(255,255,255,0.06))", color: "var(--cn-text)" }} />
          <div className="flex justify-end">
            <button onClick={submitAppeal} disabled={submitting || !subject.trim() || !body.trim()} className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40" style={{ background: "#e11d48", color: "#fff" }}>Отправить администраторам</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading ? (
          <div className="text-center text-sm opacity-60 py-8">Загрузка…</div>
        ) : appeals.length === 0 ? (
          <div className="text-center text-sm opacity-60 py-8">У вас пока нет обращений</div>
        ) : (
          appeals.map((a) => (
            <button key={a.id} onClick={() => setOpenId(a.id)} className="w-full text-left rounded-xl p-3 transition" style={{ background: "var(--cn-surface-2, rgba(255,255,255,0.05))" }}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{a.subject}</div>
                  <div className="text-xs opacity-60 truncate">{a.body}</div>
                </div>
                <span className="text-[11px] rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: STATUS_TINT[a.status] + "22", color: STATUS_TINT[a.status] }}>
                  {STATUS_LABEL[a.status] || a.status}
                </span>
              </div>
              <div className="text-[11px] opacity-50 mt-1">{a._count.messages} сообщ.</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
