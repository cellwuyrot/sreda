"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

import Link from "next/link";
import BackButton from "@/components/ui/BackButton"; // BACK-STEP

import { useAdminBackHref, useAdminBackLabel } from "@/components/admin/useAdminBackHref"; // FIX-EDR2
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
  channel: { id: string; name: string } | null;
  _count: { messages: number };
}
interface AppealMessageItem { id: string; body: string; isAdmin: boolean; createdAt: string; author: AppealAuthor }
interface AppealDetail extends AppealListItem { messages: AppealMessageItem[] }
/** Связка обращения с деловым чатом: разговор и тот, кто его ведёт. */
interface BusinessLink { conversationId: string; handlerId: string | null; handlerName: string | null }

const STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;
const STATUS_LABEL: Record<string, string> = { OPEN: "Открыто", IN_PROGRESS: "В работе", CLOSED: "Закрыто" };
const STATUS_TINT: Record<string, string> = { OPEN: "#22c55e", IN_PROGRESS: "#f59e0b", CLOSED: "#64748b" };

/* ROLE-STRUCT: по 10 обращений на страницу и поиск по списку: раньше весь
   список рисовался целиком и искать заявку приходилось поиском браузера. */
const PER_PAGE = 10;

function categoryLabel(category: string): string {
  if (category.startsWith("BAN_APPEAL:")) return "Обжалование блокировки";
  if (category === "COOPERATION") return "Заявка на сотрудничество"; // FIX-COOP
  if (category === "GENERAL") return "Обращение из TZ Connect";
  return category || "Без категории";
}

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

export default function AdminAppealsPage() {
  // FIX-EDR2: редактору «Назад» ведёт в «Редакторскую», админу — в админку
  const backHref = useAdminBackHref();
  const backLabel = useAdminBackLabel();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [appeals, setAppeals] = useState<AppealListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppealDetail | null>(null);
  const [business, setBusiness] = useState<BusinessLink | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState(""); // ROLE-STRUCT: поиск обращения
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") router.push("/");
  }, [session, status, router]);

  const fetchAppeals = useCallback(() => {
    setLoading(true);
    const q = filter ? `&status=${filter}` : "";
    fetch(`/api/appeals?scope=admin${q}`)
      .then((r) => r.json())
      .then((d) => setAppeals(Array.isArray(d.appeals) ? d.appeals : []))
      .catch(() => setAppeals([]))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { fetchAppeals(); }, [fetchAppeals]);

  /* Вместе с обращением забираем связку с деловым чатом: кто ведёт разговор и
     куда идти отвечать. Без этого не видно, занята ли заявка, и двое могут
     ответить одному клиенту разное. */
  const fetchDetail = useCallback((id: string) => {
    fetch(`/api/appeals/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setDetail(d.appeal || null);
        setBusiness(d.business ?? null);
        publishUnread(d.unreadLeft);
      })
      .catch(() => { setDetail(null); setBusiness(null); });
  }, []);

  useEffect(() => { if (openId) fetchDetail(openId); else setDetail(null); }, [openId, fetchDetail]);

  const sendReply = async () => {
    if (!reply.trim() || !openId || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/appeals/${openId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: reply }),
      });
      if (res.ok) { setReply(""); fetchDetail(openId); fetchAppeals(); }
    } finally { setSending(false); }
  };

  const changeStatus = async (newStatus: string) => {
    if (!openId) return;
    const res = await fetch(`/api/appeals/${openId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) { fetchDetail(openId); fetchAppeals(); }
  };

  /* ROLE-STRUCT: безвозвратное удаление обращения. Связанный деловой чат
     сохраняется: на сервере у него только снимается связь с заявкой. */
  const deleteAppeal = async (appeal: AppealListItem) => {
    if (deletingId) return;
    if (!window.confirm(`Удалить обращение «${appeal.subject}» безвозвратно?\nПереписка по заявке будет удалена, отменить действие нельзя.`)) return;
    setDeletingId(appeal.id);
    setDeleteError("");
    try {
      const res = await fetch(`/api/appeals/${appeal.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setDeleteError(data?.error || "Не удалось удалить обращение");
        return;
      }
      setAppeals((prev) => prev.filter((a) => a.id !== appeal.id));
      if (openId === appeal.id) { setOpenId(null); setDetail(null); setBusiness(null); }
    } catch {
      setDeleteError("Нет соединения с сервером");
    } finally {
      setDeletingId(null);
    }
  };

  const needle = query.trim().toLowerCase();
  const visible = appeals.filter((a) => {
    if (!needle) return true;
    return [a.subject, a.body, a.author.name, a.author.username, a.channel?.name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = visible.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  if (status === "loading") return <div className="p-8 text-white/60">Загрузка…</div>;

  return (
    <div className="min-h-screen text-white p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <BackButton fallback={backHref} className="text-sm text-white/60 hover:text-white">{backLabel}</BackButton>
      </div>
      <h1 className="text-3xl font-bold mb-1">Обращения</h1>
      <p className="text-white/50 mb-6">История обращений пользователей и обратная связь</p>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setFilter("")} className={"px-3 py-1.5 rounded-lg text-sm " + (filter === "" ? "bg-white/20" : "bg-white/5 hover:bg-white/10")}>Все</button>
        {STATUSES.map((st) => (
          <button key={st} onClick={() => setFilter(st)} className={"px-3 py-1.5 rounded-lg text-sm " + (filter === st ? "bg-white/20" : "bg-white/5 hover:bg-white/10")} style={{ color: STATUS_TINT[st] }}>{STATUS_LABEL[st]}</button>
        ))}
      </div>

      {/* ROLE-STRUCT: поиск обращения и кнопка напротив него. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="Поиск: тема, текст, автор, канал"
          className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm outline-none"
        />
        <button onClick={() => { setPage(1); fetchAppeals(); }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium">Обновить</button>
        {query && (
          <button onClick={() => { setQuery(""); setPage(1); }} className="rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10">Сбросить</button>
        )}
      </div>
      {deleteError && <p className="mb-3 text-sm text-red-400">{deleteError}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* List */}
        <div className="space-y-2">
          {loading ? (
            <div className="text-white/50 py-8 text-center">Загрузка…</div>
          ) : pageItems.length === 0 ? (
            <div className="text-white/50 py-8 text-center">Нет обращений</div>
          ) : (
            pageItems.map((a) => (
              <button key={a.id} onClick={() => setOpenId(a.id)} className={"w-full text-left rounded-xl p-3 border transition " + (openId === a.id ? "border-white/40 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10")}>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.subject}</div>
                    <div className="text-xs text-white/50 truncate">{a.author.name} · {a.channel?.name || ""}</div>
                  </div>
                  <span className="text-[11px] rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: STATUS_TINT[a.status] + "22", color: STATUS_TINT[a.status] }}>{STATUS_LABEL[a.status] || a.status}</span>
                </div>
              </button>
            ))
          )}

          {/* ROLE-STRUCT: постранично, по 10 записей. */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <button onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={currentPage <= 1} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40">Назад</button>
              <span className="text-xs text-white/50">Страница {currentPage} из {pageCount} · всего {visible.length}</span>
              <button onClick={() => setPage((v) => Math.min(pageCount, v + 1))} disabled={currentPage >= pageCount} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40">Вперёд</button>
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="rounded-xl border border-white/10 bg-white/5 flex flex-col min-h-[400px]">
          {!detail ? (
            <div className="flex-1 flex items-center justify-center text-white/40 text-sm">Выберите обращение</div>
          ) : (
            <>
              <div className="p-4 border-b border-white/10">
                <div className="font-semibold">{detail.subject}</div>
                <div className="text-xs text-white/50 mb-2">{detail.author.name} · {categoryLabel(detail.category)}</div>
                {/* Связка с деловым чатом: кто ведёт разговор и где он идёт.
                    Ответ из этой карточки попадает в чат — обратно нет, поэтому
                    ссылка нужна: продолжать разговор правильнее в чате. */}
                {business && (
                  <div className="mb-2 flex items-center gap-2 flex-wrap text-xs">
                    <span className={business.handlerName ? "text-white/60" : "text-amber-300"}>
                      {business.handlerName ? `Ведёт: ${business.handlerName}` : "Заявку ещё не взяли"}
                    </span>
                    <Link href="/connect?section=business" className="text-white/60 underline hover:text-white">
                      Открыть бизнес-чат
                    </Link>
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  {STATUSES.map((st) => (
                    <button key={st} onClick={() => changeStatus(st)} className={"px-2.5 py-1 rounded-lg text-xs border " + (detail.status === st ? "border-white/40" : "border-white/10 hover:border-white/30")} style={{ color: STATUS_TINT[st] }}>{STATUS_LABEL[st]}</button>
                  ))}
                  {/* ROLE-STRUCT: безвозвратное удаление запроса. */}
                  <button
                    onClick={() => void deleteAppeal(detail)}
                    disabled={deletingId === detail.id}
                    className="px-2.5 py-1 rounded-lg text-xs border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    {deletingId === detail.id ? "Удаление…" : "Удалить безвозвратно"}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[420px]">
                {detail.messages.map((m) => (
                  <div key={m.id} className={"flex " + (m.isAdmin ? "justify-end" : "justify-start")}>
                    <div className="max-w-[80%] rounded-2xl px-3 py-2 text-sm" style={{ background: m.isAdmin ? "rgba(37,99,235,0.25)" : "rgba(255,255,255,0.08)" }}>
                      {/* Имя вместо безличного «Администратор»: администрация
                          должна видеть, кто именно общается с клиентом. Этот
                          экран открыт только администраторам и редакторам, для
                          клиента ответ по-прежнему приходит от администрации. */}
                      <div className="text-[11px] text-white/50 mb-0.5">{m.isAdmin ? `${m.author.name} · администрация` : m.author.name}</div>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    </div>
                  </div>
                ))}
              </div>
              {detail.status !== "CLOSED" && (
                <div className="p-3 border-t border-white/10 flex gap-2">
                  <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }} placeholder="Ответ пользователю…" className="flex-1 rounded-lg px-3 py-2 text-sm bg-white/10 outline-none" />
                  <button onClick={sendReply} disabled={sending || !reply.trim()} className="rounded-lg px-4 py-2 text-sm font-medium bg-blue-600 disabled:opacity-40">Ответить</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
