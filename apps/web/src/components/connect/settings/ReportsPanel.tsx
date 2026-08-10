"use client";

import { useCallback, useEffect, useState } from "react";
import GlowAvatar from "@/components/ui/GlowAvatar";

/**
 * MODERATION: очередь жалоб группы.
 *
 * Жалоба — единственный способ обычного участника позвать модератора: игнор
 * прячет собеседника от него одного и никому ничего не сообщает. Значит, у
 * жалобы должно быть место, где её прочитают, иначе кнопка обманывает.
 *
 * Карточка показывает снимок текста на момент жалобы. Он хранится в самой
 * жалобе, а не подтягивается из сообщения: нарушитель удаляет написанное
 * первым, и без снимка модератор открыл бы пустую карточку.
 */

interface ReportUser {
  id: string;
  name: string;
  username: string | null;
  avatar?: string | null;
}

/** GlowAvatar ждёт объект пользователя целиком, включая роль. */
function avatarUser(u: ReportUser) {
  return { id: u.id, name: u.name, avatar: u.avatar ?? null, role: "MEMBER" };
}

interface ReportEntry {
  id: string;
  reason: string;
  excerpt: string | null;
  status: string;
  createdAt: string;
  handledAt: string | null;
  reporter: ReportUser;
  target: ReportUser;
  handledBy: { id: string; name: string; username: string | null } | null;
}

const REASON_LABEL: Record<string, string> = {
  spam: "Спам или реклама",
  insult: "Оскорбления",
  nsfw: "Непристойное содержимое",
  flood: "Флуд",
  scam: "Мошенничество",
  other: "Другое",
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Открыта",
  RESOLVED: "Меры приняты",
  DISMISSED: "Отклонена",
};

/** Причина хранится строкой «код: комментарий» — показываем человеческий вид. */
function readableReason(reason: string): string {
  const [code, ...rest] = reason.split(":");
  const label = REASON_LABEL[code.trim()] ?? reason;
  const comment = rest.join(":").trim();
  return comment ? `${label} — ${comment}` : label;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ReportsPanel({ groupId }: { groupId: string }) {
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"OPEN" | "ALL">("OPEN");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/reports?status=${filter}`, { credentials: "include" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && typeof data.error === "string" && data.error) || "Не удалось загрузить жалобы");
        setEntries([]);
        return;
      }
      setEntries(Array.isArray(data?.reports) ? data.reports : []);
    } catch {
      setError("Ошибка сети");
    } finally {
      setLoading(false);
    }
  }, [groupId, filter]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, status: "RESOLVED" | "DISMISSED") => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/groups/${groupId}/reports/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError((data && typeof data.error === "string" && data.error) || "Не удалось закрыть жалобу");
        return;
      }
      /* Открытые жалобы убираем из списка сразу: в режиме «Открытые» карточке
         после решения там больше не место. */
      if (filter === "OPEN") setEntries((prev) => prev.filter((e) => e.id !== id));
      else void load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {(["OPEN", "ALL"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              filter === f
                ? "bg-violet-500/10 border-violet-500/40 text-violet-600 dark:text-violet-300"
                : "bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-gray-400"
            }`}
          >
            {f === "OPEN" ? "Открытые" : "Все"}
          </button>
        ))}
        <button
          onClick={() => void load()}
          className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium border bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-gray-400"
        >
          Обновить
        </button>
      </div>

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      {loading && <p className="text-xs text-neutral-400">Загрузка…</p>}

      {!loading && entries.length === 0 && !error && (
        <p className="text-xs text-neutral-400">
          {filter === "OPEN" ? "Открытых жалоб нет." : "Жалоб пока не было."}
        </p>
      )}

      <div className="space-y-2">
        {entries.map((e) => (
          <div
            key={e.id}
            className="rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3"
          >
            <div className="flex items-start gap-2.5">
              <GlowAvatar user={avatarUser(e.target)} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                    {e.target.name}
                  </span>
                  {e.target.username && (
                    <span className="text-[11px] text-neutral-400">@{e.target.username}</span>
                  )}
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${
                      e.status === "OPEN"
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : "bg-neutral-500/15 text-neutral-500 dark:text-neutral-400"
                    }`}
                  >
                    {STATUS_LABEL[e.status] ?? e.status}
                  </span>
                </div>
                <p className="text-xs text-neutral-600 dark:text-gray-300 mt-0.5">{readableReason(e.reason)}</p>
                {e.excerpt && (
                  <p className="mt-1.5 text-xs italic text-neutral-500 dark:text-gray-400 border-l-2 border-neutral-300 dark:border-white/15 pl-2 break-words">
                    «{e.excerpt}»
                  </p>
                )}
                <p className="text-[11px] text-neutral-400 mt-1.5">
                  Пожаловался {e.reporter.username ? `@${e.reporter.username}` : e.reporter.name} · {when(e.createdAt)}
                  {e.handledBy && e.handledAt
                    ? ` · закрыл ${e.handledBy.username ? `@${e.handledBy.username}` : e.handledBy.name}, ${when(e.handledAt)}`
                    : ""}
                </p>
              </div>
            </div>

            {e.status === "OPEN" && (
              <div className="flex gap-2 mt-2.5">
                <button
                  disabled={busyId === e.id}
                  onClick={() => decide(e.id, "RESOLVED")}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500/10 border border-violet-500/40 text-violet-600 dark:text-violet-300 disabled:opacity-50"
                >
                  Меры приняты
                </button>
                <button
                  disabled={busyId === e.id}
                  onClick={() => decide(e.id, "DISMISSED")}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-neutral-100 dark:bg-white/5 border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-gray-400 disabled:opacity-50"
                >
                  Отклонить
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}
