"use client";

import { useSession } from "next-auth/react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import Spinner from "@/components/ui/Spinner";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { isOnline, timeAgo } from "@/lib/timeAgo";

import { useAdminBackHref } from "@/components/admin/useAdminBackHref"; // FIX-EDR2
import AdminCommunities from "@/components/admin/AdminCommunities"; // ADMCOMM
interface User {
  id: string;
  email: string;
  name: string;
  username: string;
  avatar: string | null;
  role: string;
  banned: boolean;
  banReason: string | null;
  bannedUntil: string | null;
  lastSeen: string | null;
  createdAt: string;
  _count: { messages: number };
}

const BAN_DURATIONS = [
  { label: "1 минута", minutes: 1 },
  { label: "5 минут", minutes: 5 },
  { label: "15 минут", minutes: 15 },
  { label: "30 минут", minutes: 30 },
  { label: "1 час", minutes: 60 },
  { label: "6 часов", minutes: 360 },
  { label: "1 день", minutes: 1440 },
  { label: "3 дня", minutes: 4320 },
  { label: "7 дней", minutes: 10080 },
  { label: "30 дней", minutes: 43200 },
  { label: "Перманентный", minutes: 0 },
];

function BanModal({ user, onClose, onBan }: {
  user: User;
  onClose: () => void;
  onBan: (userId: string, reason: string, bannedUntil: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [selectedDuration, setSelectedDuration] = useState(1440);

  const handleBan = () => {
    let bannedUntil: string | null = null;
    if (selectedDuration > 0) {
      const date = new Date();
      date.setMinutes(date.getMinutes() + selectedDuration);
      bannedUntil = date.toISOString();
    }
    onBan(user.id, reason, bannedUntil);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-white mb-4">
          Забанить пользователя: <span className="text-red-400">{user.name}</span>
        </h3>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Причина бана</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Укажите причину..."
              className="w-full bg-dark-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-2 block">Срок бана</label>
            <div className="grid grid-cols-3 gap-2">
              {BAN_DURATIONS.map((d) => (
                <button
                  key={d.minutes}
                  onClick={() => setSelectedDuration(d.minutes)}
                  className={`px-2 py-1.5 rounded-lg text-xs transition-all ${
                    selectedDuration === d.minutes
                      ? d.minutes === 0
                        ? "bg-red-600/30 text-red-400 border border-red-500/40"
                        : "bg-cyan-400/20 text-cyan-400 border border-cyan-400/30"
                      : "bg-dark-700 text-gray-400 border border-white/5 hover:border-white/20"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleBan}
              className="flex-1 px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/40 transition-all text-sm font-medium"
            >
              Забанить
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-dark-700 text-gray-400 rounded-lg hover:bg-dark-600 transition-all text-sm"
            >
              Отмена
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* FIX-ADM2: активность пользователя — сессии, входы, IP, действия */
interface UserActivity {
  activeSessions: { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastUsed: string }[];
  logins: { id: string; ip: string | null; userAgent: string | null; createdAt: string }[];
  ips: { ip: string; count: number; lastUsed: string }[];
  actions: { id: string; action: string; target: string; details: string | null; createdAt: string }[];
}

function deviceInfo(ua: string | null): string {
  if (!ua) return "Неизвестное устройство";
  const isDesktopApp = /Electron|TrioZ/i.test(ua);
  let os = "";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad/i.test(ua)) os = "iOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  if (isDesktopApp) return os ? `Десктоп-версия • ${os}` : "Десктоп-версия";
  let browser = "";
  if (/YaBrowser/i.test(ua)) browser = "Yandex Browser";
  else if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";
  const parts = ["Браузер", browser, os].filter(Boolean);
  return parts.join(" • ");
}

function ActivityModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/users/${user.id}/activity`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setActivity)
      .catch(() => setError(true));
  }, [user.id]);

  const fmt = (d: string) => new Date(d).toLocaleString("ru-RU");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">
            Активность: <span className="text-cyan-400">{user.name}</span>
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" aria-label="Закрыть">✕</button>
        </div>

        {!activity && !error && <div className="py-10 text-center text-sm text-gray-500">Загрузка…</div>}
        {error && <div className="py-10 text-center text-sm text-red-400">Не удалось загрузить данные</div>}

        {activity && (
          <div className="space-y-5">
            <section>
              <h4 className="text-sm font-semibold text-white mb-2">Активные сессии <span className="text-gray-500 font-normal">({activity.activeSessions.length})</span></h4>
              {activity.activeSessions.length === 0 ? (
                <p className="text-xs text-gray-500">Нет данных — сессии записываются при входе и появятся после следующего входа пользователя.</p>
              ) : (
                <div className="space-y-1.5">
                  {activity.activeSessions.map((s) => (
                    <div key={s.id} className="rounded-lg bg-dark-700/60 border border-white/5 px-3 py-2 text-xs">
                      <div className={`font-medium ${deviceInfo(s.userAgent).startsWith("Десктоп") ? "text-fantasy-purple" : "text-cyan-400"}`}>
                        {deviceInfo(s.userAgent)}
                      </div>
                      <div className="text-gray-400 mt-0.5">IP: {s.ip || "неизвестен"} • Вход: {fmt(s.createdAt)} • Последняя активность: {fmt(s.lastUsed)}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="text-sm font-semibold text-white mb-2">Последние входы</h4>
              {activity.logins.length === 0 ? (
                <p className="text-xs text-gray-500">Нет данных о входах.</p>
              ) : (
                <div className="space-y-1">
                  {activity.logins.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center gap-x-2 text-xs text-gray-400">
                      <span className="text-gray-300">{fmt(l.createdAt)}</span>
                      <span>•</span>
                      <span>{deviceInfo(l.userAgent)}</span>
                      <span>•</span>
                      <span>IP: {l.ip || "неизвестен"}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="text-sm font-semibold text-white mb-2">IP устройства</h4>
              {activity.ips.length === 0 ? (
                <p className="text-xs text-gray-500">IP-адреса не зафиксированы.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {activity.ips.map((ip) => (
                    <span key={ip.ip} className="rounded-lg bg-dark-700/60 border border-white/5 px-2.5 py-1 text-xs text-gray-300" title={`Последнее использование: ${fmt(ip.lastUsed)}`}>
                      {ip.ip} <span className="text-gray-500">×{ip.count}</span>
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="text-sm font-semibold text-white mb-2">Последние действия</h4>
              {activity.actions.length === 0 ? (
                <p className="text-xs text-gray-500">Действий в журнале аудита нет.</p>
              ) : (
                <div className="space-y-1">
                  {activity.actions.map((a) => (
                    <div key={a.id} className="text-xs text-gray-400">
                      <span className="text-gray-300">{fmt(a.createdAt)}</span> • <span className="text-cyan-400">{a.action}</span> → {a.target}
                      {a.details && <span className="text-gray-500"> ({a.details.length > 80 ? a.details.slice(0, 80) + "…" : a.details})</span>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

export default function AdminUsersPage() {
  // FIX-EDR2: редактору «Назад» ведёт в «Редакторскую», админу — в админку
  const backHref = useAdminBackHref();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [banTarget, setBanTarget] = useState<User | null>(null);
  const [activityTarget, setActivityTarget] = useState<User | null>(null); // FIX-ADM2
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");

  /* ADMSEARCH/ADMCOMM: поиск, листание и выбранная вкладка раздела. */
  const [tab, setTab] = useState<"users" | "communities">("users");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  /* Полноэкранный спиннер показываем только на первой загрузке. Раньше
     ранний возврат смотрел на `loading`, и с появлением поиска каждая буква
     гасила бы всю страницу вместе с полем ввода — фокус терялся бы после
     первого же символа. */
  const [firstLoad, setFirstLoad] = useState(true);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") {
      router.push("/");
    }
  }, [session, status, router]);

  /* ADMSEARCH: запрос уходит на сервер с задержкой в 300 мс. Фильтровать на
     клиенте нельзя: в памяти лежит только текущий лист из 20 человек, а искать
     надо по всей базе. При новом запросе возвращаемся на первый лист. */
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  /* Номер запроса отсекает устаревшие ответы: медленный запрос по короткой
     строке может вернуться после быстрого по длинной и затереть актуальный
     результат чужими строками. */
  const requestId = useRef(0);

  const fetchUsers = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: "20" });
      if (debouncedQuery) params.set("q", debouncedQuery);
      const res = await fetch(`/api/users?${params.toString()}`);
      const data = await res.json();
      if (current !== requestId.current) return;
      /* Маршрут отдаёт конверт с листами, когда переданы параметры, и голый
         массив без них — так его читают «Значки» и «Премиум». Здесь параметры
         есть всегда, но проверка страхует от расхождения форм. */
      const list = Array.isArray(data) ? data : data.users ?? [];
      setUsers(list);
      if (Array.isArray(data)) {
        setPages(1);
        setTotal(list.length);
      } else {
        setPages(data.pages ?? 1);
        setTotal(data.total ?? 0);
        if (data.page && data.page !== page) setPage(data.page);
      }
    } finally {
      if (current === requestId.current) {
        setLoading(false);
        setFirstLoad(false);
      }
    }
  }, [page, debouncedQuery]);

  useEffect(() => {
    if ((session?.user?.role === "ADMIN" || session?.user?.role === "EDITOR")) fetchUsers();
  }, [session, fetchUsers]);

  const handleBan = async (userId: string, reason: string, bannedUntil: string | null) => {
    await fetch(`/api/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banned: true, banReason: reason, bannedUntil }),
    });
    fetchUsers();
  };

  const handleUnban = async (userId: string) => {
    await fetch(`/api/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banned: false }),
    });
    fetchUsers();
  };

  const changeRole = async (userId: string, role: string) => {
    await fetch(`/api/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    fetchUsers();
  };

  const deleteUser = async (userId: string) => {
    if (!(await confirmDialog({ message: "Удалить пользователя? Это действие необратимо.", confirmText: "Удалить", danger: true }))) return;
    await fetch(`/api/users/${userId}`, { method: "DELETE" });
    fetchUsers();
  };

  const startEditUsername = (user: User) => {
    setEditingUsername(user.id);
    setNewUsername(user.username);
    setUsernameError("");
  };

  const saveUsername = async (userId: string) => {
    setUsernameError("");
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername }),
    });
    if (!res.ok) {
      const data = await res.json();
      setUsernameError(data.error || "Ошибка");
      return;
    }
    setEditingUsername(null);
    fetchUsers();
  };

  if (status === "loading" || firstLoad) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-dark-900">
        <Spinner />
      </div>
    );
  }

  if (session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") return null;

  const formatBanUntil = (date: string | null) => {
    if (!date) return "перманентно";
    const d = new Date(date);
    if (d < new Date()) return "истёк";
    return d.toLocaleString("ru-RU");
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href={backHref} className="text-cyan-400 hover:text-cyan-300 text-sm mb-2 inline-flex items-center gap-1 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Админ-панель
            </Link>
            <h1 className="text-2xl font-bold text-white">Управление пользователями</h1>
          </div>
          <span className="text-gray-400">
            {tab === "users" ? `${total} пользователей` : "модерация сообществ"}
          </span>
        </div>

        {/* ADMCOMM: вкладки раздела. Сообщества — только для ADMIN: приостановка
            сообщества — мера административная, и сервер всё равно ответит 403
            редактору — показывать ему нерабочую вкладку не надо. */}
        {session?.user?.role === "ADMIN" && (
          <div className="mb-6 flex gap-2">
            {([
              { id: "users" as const, label: "Пользователи" },
              { id: "communities" as const, label: "Сообщества" },
            ]).map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  tab === item.id
                    ? "bg-cyan-500/20 text-cyan-300"
                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {tab === "users" ? (
          <>
            {/* ADMSEARCH: строка поиска по всей базе пользователей. */}
            <div className="mb-4 flex items-center gap-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по имени или логину…"
                className="flex-1 rounded-lg bg-black/30 border border-white/10 px-4 py-2 text-sm text-white outline-none focus:border-white/30"
              />
              {loading && <span className="text-xs text-gray-500 whitespace-nowrap">поиск…</span>}
            </div>

            {users.length === 0 ? (
              <p className="text-gray-400 py-8 text-center">
                {debouncedQuery ? "Никого не найдено" : "Пользователей пока нет"}
              </p>
            ) : (
        <div className="space-y-3">
          {users.map((user, i) => (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`glass-card p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 ${
                user.banned ? "border-red-500/30 bg-red-900/10" : ""
              }`}
            >
              <div className="relative flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400/30 to-fantasy-purple/30 flex items-center justify-center text-sm font-bold text-white">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-dark-800 ${isOnline(user.lastSeen) ? "bg-green-500" : "bg-gray-500"}`} title={isOnline(user.lastSeen) ? "Онлайн" : user.lastSeen ? timeAgo(user.lastSeen) : "Не был в сети"} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white">{user.name}</span>
                  {editingUsername === user.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveUsername(user.id);
                          if (e.key === "Escape") setEditingUsername(null);
                        }}
                        className="bg-dark-700 border border-cyan-400/30 rounded px-2 py-0.5 text-xs text-white w-32"
                        autoFocus
                      />
                      <button onClick={() => saveUsername(user.id)} className="text-cyan-400 hover:text-cyan-300 text-xs">✓</button>
                      <button onClick={() => setEditingUsername(null)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
                      {usernameError && <span className="text-red-400 text-xs">{usernameError}</span>}
                    </div>
                  ) : (
                    <button
                      onClick={() => startEditUsername(user)}
                      className="text-xs text-cyan-400/60 hover:text-cyan-400 transition-colors cursor-pointer"
                      title="Изменить логин"
                    >
                      @{user.username}
                    </button>
                  )}
                  <span className="text-xs text-gray-500">{user.email}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    user.role === "ADMIN" ? "bg-fantasy-gold/20 text-fantasy-gold" :
                    user.role === "EDITOR" ? "bg-fantasy-purple/20 text-fantasy-purple" :
                    user.role === "CONSULTANT" ? "bg-cyan-400/20 text-cyan-400" :
                    "bg-gray-700 text-gray-400"
                  }`}>
                    {user.role}
                  </span>
                  {user.banned && (
                    <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">
                      ЗАБАНЕН
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {user._count.messages} сообщений • Регистрация: {new Date(user.createdAt).toLocaleDateString("ru-RU")}
                  {" • "}
                  <span className={isOnline(user.lastSeen) ? "text-green-400" : ""}>
                    {isOnline(user.lastSeen) ? "Онлайн" : user.lastSeen ? timeAgo(user.lastSeen) : "Не был в сети"}
                  </span>
                  {user.banned && user.banReason && (
                    <span className="text-red-400"> • Причина: {user.banReason}</span>
                  )}
                  {user.banned && (
                    <span className="text-red-400"> • До: {formatBanUntil(user.bannedUntil)}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* FIX-EDR: сессии активности и назначение ролей — только для ADMIN */}
                {session?.user?.role === "ADMIN" && (
                  <button
                    onClick={() => setActivityTarget(user)}
                    className="px-3 py-1 rounded-lg text-sm transition-all bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20"
                    title="Сессии, входы, IP и действия"
                  >
                    Активность
                  </button>
                )}
                {session?.user?.role === "ADMIN" ? (
                  <select
                    value={user.role}
                    onChange={(e) => changeRole(user.id, e.target.value)}
                    className="bg-dark-700 border border-white/10 rounded-lg px-2 py-1 text-sm text-white"
                  >
                    <option value="USER">USER</option>
                    <option value="CONSULTANT">CONSULTANT</option>
                    <option value="EDITOR">EDITOR</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                ) : (
                  <span className="px-2 py-1 rounded-lg border border-white/10 text-sm text-gray-400">{user.role}</span>
                )}

                {/* Hide ban button for ADMIN users */}
                {user.role !== "ADMIN" && (
                  user.banned ? (
                    <button
                      onClick={() => handleUnban(user.id)}
                      className="px-3 py-1 rounded-lg text-sm transition-all bg-green-600/20 text-green-400 hover:bg-green-600/40"
                    >
                      Разбанить
                    </button>
                  ) : (
                    <button
                      onClick={() => setBanTarget(user)}
                      className="px-3 py-1 rounded-lg text-sm transition-all bg-red-600/20 text-red-400 hover:bg-red-600/40"
                    >
                      Бан
                    </button>
                  )
                )}

                {/* FIX-EDR: удаление пользователей — только для ADMIN */}
                {session?.user?.role === "ADMIN" && (
                  <button
                    onClick={() => deleteUser(user.id)}
                    className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                    title="Удалить"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
            )}

            {/* ADMSEARCH: листы по 20 пользователей на странице. */}
            {pages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Назад
                </button>
                <span className="text-sm text-gray-400">
                  Страница {page} из {pages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  disabled={page >= pages}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Вперёд
                </button>
              </div>
            )}
          </>
        ) : (
          <AdminCommunities />
        )}
      </div>

      {/* Ban Modal */}
      <AnimatePresence>
        {banTarget && (
          <BanModal
            user={banTarget}
            onClose={() => setBanTarget(null)}
            onBan={handleBan}
          />
        )}
      </AnimatePresence>

      {/* FIX-ADM2: Activity Modal */}
      <AnimatePresence>
        {activityTarget && (
          <ActivityModal user={activityTarget} onClose={() => setActivityTarget(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
