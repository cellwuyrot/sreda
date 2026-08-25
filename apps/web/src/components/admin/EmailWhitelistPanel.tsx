"use client";

/* MAIL-WHITELIST: блок «Белые списки» в разделе «Сервисы и система».

   Сейчас в блоке один раздел — регистрация по почте. Структура сознательно
   сделана двухуровневой (блок → раздел): следующие списки — по телефонам
   или странам — встанут рядом, а не потребуют переделки шапки.

   О самом списке знает только администратор: тот, кто регистрируется, видит
   только «Регистрация невозможна» (см. lib/emailWhitelist.ts). */

import { useCallback, useEffect, useState } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

interface WhitelistRow {
  id: string;
  domain: string;
  note: string;
  active: boolean;
}

interface Payload {
  rows: WhitelistRow[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
}

const API = "/api/admin/email-whitelist";

export default function EmailWhitelistPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /* Правка строки на месте: отдельное окно ради двух полей — лишний шаг. */
  const [editing, setEditing] = useState<{ id: string; domain: string; note: string } | null>(null);

  const load = useCallback(async (targetPage: number, search: string) => {
    const params = new URLSearchParams({ page: String(targetPage) });
    if (search.trim()) params.set("q", search.trim());
    try {
      const res = await fetch(`${API}?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      setData(await res.json());
    } catch {
      /* сеть недоступна — остаётся прежний снимок списка */
    }
  }, []);

  useEffect(() => {
    /* Поиск с задержкой: запрос на каждую букву здесь ни к чему. */
    const timer = setTimeout(() => { void load(page, query); }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, page, query]);

  const add = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, note }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Не удалось добавить домен");
        return;
      }
      setDomain("");
      setNote("");
      await load(page, query);
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (body: Record<string, unknown>) => {
    setError("");
    try {
      const res = await fetch(API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Не удалось сохранить");
        return false;
      }
      await load(page, query);
      return true;
    } catch {
      setError("Сеть недоступна");
      return false;
    }
  };

  const remove = async (row: WhitelistRow) => {
    const ok = await confirmDialog({
      message:
        `Убрать «${row.domain}» из белого списка?\n\n` +
        "Новые регистрации с этого домена станут невозможны. Уже созданные аккаунты не тронуты.",
      confirmText: "Убрать",
      danger: true,
    });
    if (!ok) return;
    setError("");
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error || "Не удалось удалить запись");
        return;
      }
      await load(page, query);
    } catch {
      setError("Сеть недоступна");
    }
  };

  const rows = data?.rows ?? [];
  const pages = data?.pages ?? 1;
  const currentPage = data?.page ?? page;

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-5">
      <h2 className="mb-1 text-base font-semibold text-neutral-900 dark:text-white">Белые списки</h2>
      <p className="mb-4 text-xs text-neutral-500 dark:text-gray-400">
        Ограничения доступа на входе в проект
      </p>

      <div className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Регистрация по почте</h3>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-gray-400">
              Регистрация разрешена только с доменов из этой таблицы.
              Заявитель видит только «Регистрация невозможна» — ни списка, ни причины.
            </p>
          </div>
          <span className="rounded-full bg-neutral-200/70 dark:bg-white/10 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:text-gray-400">
            {data ? `${data.total} доменов` : "…"}
          </span>
        </div>

        {/* Добавление */}
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && domain.trim() && !busy) void add(); }}
            placeholder="domain.ru"
            maxLength={100}
            className="min-w-[180px] flex-1 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-white outline-none focus:border-violet-500 dark:focus:border-cyan-400"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && domain.trim() && !busy) void add(); }}
            placeholder="Примечание — чей это сервис"
            maxLength={80}
            className="min-w-[180px] flex-1 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-white outline-none focus:border-violet-500 dark:focus:border-cyan-400"
          />
          <button
            onClick={() => void add()}
            disabled={busy || !domain.trim()}
            className="rounded-xl bg-violet-500 dark:bg-cyan-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-600 dark:hover:bg-cyan-600 disabled:opacity-50"
          >
            Добавить
          </button>
        </div>

        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="Поиск по домену или примечанию"
          className="mb-3 w-full rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-white outline-none focus:border-violet-500 dark:focus:border-cyan-400"
        />

        {error && (
          <p className="mb-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p>
        )}

        {/* Таблица: до десяти строк на страницу. */}
        <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-white/10">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-neutral-400">
              {data ? "Ничего не найдено" : "Загрузка…"}
            </p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 last:border-b-0 dark:border-white/5"
              >
                {editing && editing.id === row.id ? (
                  <>
                    <input
                      value={editing.domain}
                      onChange={(e) => setEditing({ ...editing, domain: e.target.value })}
                      maxLength={100}
                      className="min-w-[140px] flex-1 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 px-2 py-1 text-sm text-neutral-900 dark:text-white outline-none"
                    />
                    <input
                      value={editing.note}
                      onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                      maxLength={80}
                      placeholder="Примечание"
                      className="min-w-[140px] flex-1 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 px-2 py-1 text-sm text-neutral-900 dark:text-white outline-none"
                    />
                    <button
                      onClick={async () => {
                        const saved = await patch({ id: row.id, domain: editing.domain, note: editing.note });
                        if (saved) setEditing(null);
                      }}
                      className="rounded-lg bg-violet-500 dark:bg-cyan-500 px-3 py-1 text-xs font-medium text-white"
                    >
                      Сохранить
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="rounded-lg px-3 py-1 text-xs text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white"
                    >
                      Отмена
                    </button>
                  </>
                ) : (
                  <>
                    <span className={`text-sm ${row.active ? "text-neutral-900 dark:text-white" : "text-neutral-400 line-through dark:text-gray-500"}`}>
                      @{row.domain}
                    </span>
                    {row.note && (
                      <span className="text-xs text-neutral-400">{row.note}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      {/* Выключение вместо удаления: домен можно закрыть на время,
                          не теряя строку и примечание к ней. */}
                      <button
                        onClick={() => void patch({ id: row.id, active: !row.active })}
                        className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                          row.active
                            ? "bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20"
                            : "bg-neutral-200/70 dark:bg-white/10 text-neutral-500 dark:text-gray-400"
                        }`}
                        title={row.active ? "Домен разрешён — отключить" : "Домен отключён — включить"}
                      >
                        {row.active ? "разрешён" : "отключён"}
                      </button>
                      <button
                        onClick={() => setEditing({ id: row.id, domain: row.domain, note: row.note })}
                        className="rounded-lg px-2 py-1 text-xs text-neutral-500 hover:text-violet-600 dark:text-gray-400 dark:hover:text-cyan-400"
                      >
                        Изменить
                      </button>
                      <button
                        onClick={() => void remove(row)}
                        className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                      >
                        Удалить
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Постранично: список доменов растёт и целиком не нужен. */}
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between text-xs text-neutral-500 dark:text-gray-400">
            <button
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="rounded-lg border border-neutral-200 dark:border-white/10 px-3 py-1 disabled:opacity-40"
            >
              Назад
            </button>
            <span>Страница {currentPage} из {pages}</span>
            <button
              onClick={() => setPage(Math.min(pages, currentPage + 1))}
              disabled={currentPage >= pages}
              className="rounded-lg border border-neutral-200 dark:border-white/10 px-3 py-1 disabled:opacity-40"
            >
              Вперёд
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
