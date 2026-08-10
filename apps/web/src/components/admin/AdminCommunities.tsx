"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * ADM-COMM: вкладка «Сообщества» внутри раздела «Пользователи».
 *
 * Вынесена в отдельный файл не из-за переиспользования — второго места
 * вызова не предвидится, — а потому что страница пользователей и так занимает
 * полтысячи строк. Две несвязанные таблицы со своими модалками в одном
 * файле читаются плохо.
 */

interface CommunityOwner {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  avatar: string | null;
  role: string;
  banned: boolean;
  lastSeen: string | null;
}

interface Community {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  paused: boolean;
  isMain: boolean;
  createdAt: string;
  memberCount: number;
  channelCount: number;
  owner: CommunityOwner;
}

/** Шаг листания — тот же, что и у списка пользователей. */
const PER_PAGE = 20;

/* ════════════════ Модалка письма создателю ══════════════════════ */

function MessageModal({
  community,
  onClose,
  onSent,
}: {
  community: Community;
  onClose: () => void;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerLabel = community.owner.name || community.owner.username || "создатель";

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/communities/${community.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Не удалось отправить сообщение");
        setSending(false);
        return;
      }
      onSent();
      onClose();
    } catch {
      setError("Сетевая ошибка");
      setSending(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="glass-card w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-1">Сообщение создателю</h3>
        <p className="text-sm text-gray-400 mb-4">
          {ownerLabel} — сообщество «{community.name}»
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          maxLength={2000}
          autoFocus
          placeholder="Текст сообщения…"
          className="w-full rounded-lg bg-black/30 border border-white/10 p-3 text-sm outline-none focus:border-white/30 resize-none"
        />
        <div className="mt-1 text-right text-xs text-gray-500">{text.length} / 2000</div>

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <p className="mt-3 text-xs text-gray-500">
          Сообщение придёт создателю в личные сообщения от вашего имени.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition"
          >
            Отмена
          </button>
          <button
            onClick={send}
            disabled={!text.trim() || sending}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm transition"
          >
            {sending ? "Отправка…" : "Отправить"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ═════════════════════ Список сообществ ════════════════════════ */

export default function AdminCommunities() {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<Community | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /* Поиск с задержкой: без неё каждая буква — отдельный запрос к базе,
     причём по четырём полям через OR с присоединённой таблицей владельца. */
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  /* Гонка ответов: медленный запрос по короткому запросу может вернуться после
     быстрого по длинному и затереть актуальный результат. Номер запроса
     отсекает устаревшие ответы. */
  const requestId = useRef(0);

  const fetchCommunities = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
      if (debouncedQuery) params.set("q", debouncedQuery);
      const res = await fetch(`/api/admin/communities?${params.toString()}`);
      if (!res.ok) {
        if (current === requestId.current) setCommunities([]);
        return;
      }
      const data = await res.json();
      if (current !== requestId.current) return;
      setCommunities(data.communities ?? []);
      setPages(data.pages ?? 1);
      setTotal(data.total ?? 0);
      if (data.page && data.page !== page) setPage(data.page);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [page, debouncedQuery]);

  useEffect(() => {
    fetchCommunities();
  }, [fetchCommunities]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const togglePause = async (community: Community) => {
    if (busyId) return;
    const next = !community.paused;
    /* Собственный диалог репозитория, а не браузерный confirm. Подтверждение
       спрашиваем только на приостановке: возобновление — действие
       восстанавливающее, лишний вопрос только мешает. */
    if (
      next &&
      !(await confirmDialog({
        message: `Приостановить работу сообщества «${community.name}»? Контент станет виден только владельцу и администрации сообщества.`,
        confirmText: "Приостановить",
        danger: true,
      }))
    ) {
      return;
    }
    setBusyId(community.id);
    try {
      const res = await fetch(`/api/admin/communities/${community.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setToast(data?.error || "Не удалось изменить статус");
        return;
      }
      /* Правим одну строку на месте, а не перетягиваем лист: сортировка ставит
         приостановленные наверх, и строка ускакала бы из-под курсора сразу
         после нажатия. */
      setCommunities((prev) =>
        prev.map((item) => (item.id === community.id ? { ...item, paused: next } : item)),
      );
      setToast(next ? "Сообщество приостановлено" : "Работа сообщества возобновлена");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {/* Поиск */}
      <div className="mb-4 flex items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по названию или создателю…"
          className="flex-1 rounded-lg bg-black/30 border border-white/10 px-4 py-2 text-sm outline-none focus:border-white/30"
        />
        <span className="text-sm text-gray-400 whitespace-nowrap">{total} сообществ</span>
      </div>

      {loading ? (
        <p className="text-gray-400 py-8 text-center">Загрузка…</p>
      ) : communities.length === 0 ? (
        <p className="text-gray-400 py-8 text-center">
          {debouncedQuery ? "Ничего не найдено" : "Сообществ пока нет"}
        </p>
      ) : (
        <div className="space-y-3">
          {communities.map((community, i) => {
            const owner = community.owner;
            const ownerLabel = owner.name || owner.username || "—";
            return (
              <motion.div
                key={community.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}
                className="glass-card p-4 flex items-center gap-4 flex-wrap"
              >
                <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center text-lg shrink-0 overflow-hidden">
                  {community.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={community.icon} alt="" className="w-full h-full object-cover" />
                  ) : (
                    community.name.slice(0, 1).toUpperCase()
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{community.name}</span>
                    {community.isMain && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                        главное
                      </span>
                    )}
                    {community.paused && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                        приостановлено
                      </span>
                    )}
                  </div>
                  {/* Только создатель — состав участников в модерации не нужен и с
                      сервера не приходит. */}
                  <div className="text-sm text-gray-400 truncate">
                    Создатель: <span className="text-gray-300">{ownerLabel}</span>
                    {owner.username && <span className="text-gray-500"> @{owner.username}</span>}
                    {owner.banned && <span className="text-red-400"> · забанен</span>}
                  </div>
                  {owner.email && (
                    <div className="text-xs text-gray-500 truncate">{owner.email}</div>
                  )}
                  <div className="text-xs text-gray-500 mt-0.5">
                    {community.memberCount} участников · {community.channelCount} каналов · с{" "}
                    {new Date(community.createdAt).toLocaleDateString("ru-RU")}
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={() => setMessageTarget(community)}
                    className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition whitespace-nowrap"
                  >
                    Написать создателю
                  </button>
                  <button
                    onClick={() => togglePause(community)}
                    disabled={busyId === community.id || (community.isMain && !community.paused)}
                    title={
                      community.isMain && !community.paused
                        ? "Главное сообщество проекта нельзя приостановить"
                        : undefined
                    }
                    className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                      community.paused
                        ? "bg-emerald-600/80 hover:bg-emerald-600"
                        : "bg-amber-600/80 hover:bg-amber-600"
                    }`}
                  >
                    {community.paused ? "Возобновить" : "Приостановить"}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Листы */}
      {pages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            Назад
          </button>
          <span className="text-sm text-gray-400">
            Страница {page} из {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            Вперёд
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-black/80 border border-white/10 text-sm">
          {toast}
        </div>
      )}

      <AnimatePresence>
        {messageTarget && (
          <MessageModal
            community={messageTarget}
            onClose={() => setMessageTarget(null)}
            onSent={() => setToast("Сообщение отправлено создателю")}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
