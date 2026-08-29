"use client";

import { useSession } from "next-auth/react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
  /** Сколько событий схлопнуто в это уведомление (группировка беседы). */
  count?: number;
  /** Предмет уведомления — по нему гасится вся беседа разом. */
  entityType?: string | null;
  entityId?: string | null;
}

const TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  dm: { label: "Личные сообщения", icon: "💬", color: "text-blue-400" },
  mention: { label: "Упоминания", icon: "@", color: "text-violet-400" },
  game_invite: { label: "Игровые приглашения", icon: "🎮", color: "text-green-400" },
  game: { label: "Игры", icon: "🎲", color: "text-yellow-400" },
  system: { label: "Система", icon: "🔔", color: "text-gray-400" },
  // TASK-NOTIFY: уведомления о задачах — назначена, изменён статус и т.д.
  task_assigned: { label: "Задачи", icon: "✅", color: "text-amber-400" },
  task: { label: "Задачи", icon: "✅", color: "text-amber-400" },
};

function getTypeInfo(type: string) {
  return TYPE_LABELS[type] || { label: type, icon: "🔔", color: "text-gray-400" };
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  const days = Math.floor(hrs / 24);
  return `${days} дн назад`;
}

export default function NotificationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/login");
  }, [status, router]);

  const fetchNotifications = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("type", filter);
    const res = await fetch(`/api/notifications?${params}`);
    if (res.ok) {
      const data = await res.json();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    if (status === "authenticated") fetchNotifications();
  }, [status, fetchNotifications]);

  // Сообщаем колокольчику в Navbar актуальный остаток непрочитанных, чтобы бейдж
  // не «залипал» и не обнулялся раньше времени.
  const emitUnread = (count: number) => {
    window.dispatchEvent(
      new CustomEvent("tz-notifications-read", { detail: { unreadCount: Math.max(0, count) } })
    );
  };

  const markRead = async (id: string) => {
    const target = notifications.find((n) => n.id === id);
    if (!target) return;
    /* Уведомление беседы сгруппировано, но на всякий случай (старые записи,
       созданные до группировки) гасим по предмету — тогда пропадут все
       непрочитанные того же чата, а не только эта строка. Так закрывается баг
       «прочитал одно — остальные из чата висят непрочитанными». */
    const subject = target.entityType && target.entityId
      ? { entityType: target.entityType, entityId: target.entityId }
      : null;
    const body = subject ?? { id };

    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);

    setNotifications((prev) =>
      prev.map((n) => {
        if (n.id === id) return { ...n, read: true };
        // Соседи из той же беседы тоже прочитаны.
        if (subject && n.entityType === subject.entityType && n.entityId === subject.entityId) {
          return { ...n, read: true };
        }
        return n;
      }),
    );
    // Остаток непрочитанного берём у сервера (одна правда), а не пересчитываем.
    const next =
      data && typeof data.unreadCount === "number"
        ? data.unreadCount
        : Math.max(0, unreadCount - 1);
    setUnreadCount(next);
    emitUnread(next);
  };

  const markAllRead = async () => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    emitUnread(0);
  };

  const deleteAll = async () => {
    if (!(await confirmDialog({ message: "Удалить все уведомления?", confirmText: "Удалить", danger: true }))) return;
    await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteAll: true }),
    });
    setNotifications([]);
    setUnreadCount(0);
    emitUnread(0);
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (status === "loading" || loading) {
    return <div className="min-h-screen flex items-center justify-center text-neutral-400">Загрузка...</div>;
  }

  const filters = [
    { key: "all", label: "Все" },
    { key: "dm", label: "ЛС" },
    { key: "mention", label: "Упоминания" },
    { key: "task_assigned", label: "Задачи" },
    { key: "game_invite", label: "Игры" },
    { key: "system", label: "Система" },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          {/* FIX-BACKEXIT: тот же единый выход в мессенджер. */}
          <Link href="/connect" aria-label="Назад в TZ.Connect" className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Уведомления</h1>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-violet-600 text-white text-xs font-medium">{unreadCount}</span>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                filter === f.key
                  ? "bg-violet-600 text-white"
                  : "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-gray-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mb-4">
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-xs text-violet-500 hover:text-violet-400 transition-colors">
              Прочитать все
            </button>
          )}
          {notifications.length > 0 && (
            <button onClick={deleteAll} className="text-xs text-red-400 hover:text-red-300 transition-colors ml-auto">
              Удалить все
            </button>
          )}
        </div>

        {/* Notifications list */}
        {notifications.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🔔</div>
            <p className="text-neutral-500 dark:text-gray-400 text-sm">Нет уведомлений</p>
          </div>
        ) : (
          <div className="space-y-1">
            <AnimatePresence>
              {notifications.map((n) => {
                const info = getTypeInfo(n.type);
                return (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className={`flex items-start gap-3 p-3 rounded-xl transition-colors cursor-pointer ${
                      n.read
                        ? "bg-neutral-50 dark:bg-neutral-900/50"
                        : "bg-white dark:bg-neutral-800/80 border border-neutral-200 dark:border-white/5"
                    }`}
                    onClick={() => {
                      if (!n.read) markRead(n.id);
                      if (n.link) router.push(n.link);
                    }}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${
                      n.read ? "bg-neutral-200 dark:bg-neutral-700" : "bg-violet-500/10"
                    }`}>
                      {info.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${n.read ? "text-neutral-500 dark:text-gray-400" : "text-neutral-900 dark:text-white"}`}>
                          {n.title}
                        </span>
                        {/* Группировка: сколько событий схлопнуто в это уведомление.
                            Показываем только у непрочитанного — «новых» у прочитанного
                            не бывает. */}
                        {!n.read && (n.count ?? 1) > 1 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-500 text-[10px] font-semibold flex-shrink-0">
                            {(n.count ?? 1) > 99 ? "99+" : n.count} новых
                          </span>
                        )}
                        {!n.read && <div className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />}
                      </div>
                      {n.body && (() => {
                        const imgMatch = n.body.match(/\[img\](.*?)\[\/img\]/);
                        const text = n.body.replace(/\n?\[img\].*?\[\/img\]/, "").trim();
                        const isExpanded = expanded.has(n.id);
                        // Показываем «Показать полностью», только если текст реально
                        // может обрезаться (длинный или многострочный).
                        const canExpand = text.length > 120 || text.includes("\n");
                        return (
                          <>
                            {text && (
                              <p
                                className={`text-xs text-neutral-400 dark:text-gray-500 mt-0.5 whitespace-pre-wrap ${
                                  isExpanded ? "" : "line-clamp-2"
                                }`}
                              >
                                {text}
                              </p>
                            )}
                            {text && canExpand && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpanded(n.id);
                                }}
                                className="mt-0.5 text-[11px] font-medium text-violet-500 hover:text-violet-400 transition-colors"
                              >
                                {isExpanded ? "Свернуть" : "Показать полностью"}
                              </button>
                            )}
                            {imgMatch && (
                              <div
                                className="mt-1.5 rounded-lg overflow-hidden border border-neutral-200 dark:border-white/10"
                                style={isExpanded ? undefined : { maxHeight: 120 }}
                              >
                                <img
                                  src={imgMatch[1]}
                                  alt=""
                                  className="w-full h-auto object-cover"
                                  style={isExpanded ? undefined : { maxHeight: 120 }}
                                />
                              </div>
                            )}
                          </>
                        );
                      })()}
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] ${info.color}`}>{info.label}</span>
                        <span className="text-[10px] text-neutral-400">{timeAgo(n.createdAt)}</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}