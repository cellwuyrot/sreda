"use client";

/**
 * Игнор-лист: кого вы скрыли и как это отменить.
 *
 * Игнор ставится правым кликом в чате и хранится на сервере, но посмотреть весь
 * список было негде. Отменить скрытие можно было, только найдя сообщение
 * человека — то есть именно то, что игнор и прячет. Замкнутый круг: чем лучше
 * работает функция, тем труднее её отменить.
 */

import { useCallback, useEffect, useState } from "react";
import GlowAvatar from "@/components/ui/GlowAvatar";
import InfoTooltip from "@/components/ui/InfoTooltip";

interface IgnoredUser {
  id: string;
  name: string;
  username: string | null;
  avatar: string | null;
  since: string;
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export default function IgnoreListSection() {
  const [users, setUsers] = useState<IgnoredUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ignores", { credentials: "include" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && typeof data.error === "string" && data.error) || "Не удалось загрузить список");
        return;
      }
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch {
      setError("Ошибка сети");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function unignore(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/ignores?userId=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError((data && typeof data.error === "string" && data.error) || "Не удалось снять игнор");
        return;
      }
      /* Убираем из списка сразу: перезагрузка ради одной строки — лишний
         запрос и заметное мигание всего списка. */
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-neutral-900 dark:text-white">
          Игнорируемые
          <InfoTooltip text="Их сообщения свёрнуты в ленте. Игнор общий для всех сообществ и действует на всех устройствах." side="bottom" />
        </h2>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      {loading && <p className="text-xs text-neutral-400">Загрузка…</p>}

      {!loading && users.length === 0 && !error && (
        <p className="text-xs text-neutral-400">Список пуст. Скрыть человека можно правым кликом по его имени в чате.</p>
      )}

      <div className="space-y-2">
        {users.map((u) => (
          <div
            key={u.id}
            className="flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-white/10 p-2.5"
          >
            <GlowAvatar user={{ id: u.id, name: u.name, avatar: u.avatar, role: "MEMBER" }} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-900 dark:text-white truncate">{u.name}</p>
              <p className="text-[11px] text-neutral-400 truncate">
                {u.username ? `@${u.username} · ` : ""}скрыт {when(u.since)}
              </p>
            </div>
            <button
              onClick={() => unignore(u.id)}
              disabled={busyId === u.id}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Вернуть
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
