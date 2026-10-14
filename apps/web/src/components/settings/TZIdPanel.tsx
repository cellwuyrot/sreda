"use client";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
const card =
  "rounded-xl border border-neutral-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03] space-y-4";
const button =
  "min-h-[44px] rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-white/20 dark:hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:opacity-50";
type App = {
  id: string;
  name: string;
  scopes: string[];
  enabled: boolean;
  lastUsedAt: string;
};
type Session = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  lastUsed: string;
  current: boolean;
  source?: string;
};
const scopeNames: Record<string, string> = {
  openid: "TZ ID",
  profile: "Имя, username, аватар",
  email: "Email",
  offline_access: "Продление доступа",
};
export function TZIdOverview({
  id,
  emailVerified,
}: {
  id: string;
  emailVerified: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className={card} aria-label="TZ ID">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-violet-600 dark:text-violet-300">
            TZ ID · один аккаунт
          </p>
          <h2 className="text-xl font-semibold mt-1">
            Ваш постоянный идентификатор
          </h2>
        </div>
        <span className="text-sm">
          {emailVerified ? "✓ Email подтверждён" : "Email не подтверждён"}
        </span>
      </div>
      <p className="text-sm text-neutral-600 dark:text-gray-400">
        Имя и username можно менять. TZ ID остаётся прежним и связывает ваш
        аккаунт с подключёнными проектами.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <code className="min-w-0 break-all text-sm flex-1">{id}</code>
        <button
          className={button}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(id);
              setCopied(true);
              setError("");
            } catch {
              setError(
                "Не удалось скопировать. Выделите идентификатор вручную.",
              );
            }
          }}
        >
          {copied ? "Скопировано" : "Копировать TZ ID"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <a
        href="https://id.trioz.ru"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[44px] items-center text-sm text-violet-600 dark:text-violet-300 underline"
      >
        Открыть id.trioz.ru
      </a>
    </section>
  );
}
export default function TZIdPanel({
  section,
}: {
  section: "security" | "applications";
}) {
  const [apps, setApps] = useState<App[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        section === "applications"
          ? "/api/tz-id/applications"
          : "/api/profile/sessions",
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error("Не удалось загрузить данные. Попробуйте ещё раз.");
      const data = await response.json();
      if (section === "applications") setApps(data);
      else setSessions(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(
      section === "applications"
        ? "/api/tz-id/applications"
        : "/api/profile/sessions",
      { cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить данные");
        const data = await response.json();
        if (!cancelled) {
          if (section === "applications") setApps(data);
          else setSessions(data);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section]);
  async function revoke(id?: string, current = false) {
    if (
      !(await confirmDialog({
        title:
          section === "applications"
            ? "Отключить приложение?"
            : "Завершить сеанс?",
        message:
          section === "applications"
            ? "Приложение потеряет доступ к API TZ ID. Для нового доступа потребуется ваше разрешение. Его собственный сеанс может сохраняться до следующей проверки доступа."
            : "Этот сеанс больше не сможет использовать ваш аккаунт.",
        confirmText: "Подтвердить",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const endpoint =
        section === "applications"
          ? `/api/tz-id/applications?clientId=${encodeURIComponent(id || "")}`
          : `/api/profile/sessions${id ? `?sessionId=${encodeURIComponent(id)}` : ""}`;
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error("Не удалось завершить доступ");
      if (current) await signOut({ callbackUrl: "/auth/signin" });
      else await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={card}>
      <div>
        <h2 className="text-xl font-semibold">
          {section === "applications"
            ? "Подключённые приложения"
            : "Устройства и сеансы"}
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-gray-400">
          {section === "applications"
            ? "Только приложения, которым вы разрешили доступ. Пароль и личная переписка не передаются."
            : "Входы в TrioZ и TZ ID. Завершение сеанса также отзывает выданный через него доступ к приложениям."}
        </p>
      </div>
      {loading ? (
        <p role="status">Загрузка…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button className={button} onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : section === "applications" ? (
        apps.length ? (
          apps.map((app) => (
            <article
              key={app.id}
              className="border-t border-neutral-200 dark:border-white/10 pt-4 space-y-2"
            >
              <h3 className="font-semibold break-words">
                {app.name}
                {!app.enabled ? " · отключено администратором" : ""}
              </h3>
              <p className="text-sm text-neutral-600 dark:text-gray-400">
                {app.scopes
                  .map((scope) => scopeNames[scope] || scope)
                  .join(" · ")}
              </p>
              <p className="text-sm">
                Разрешение обновлено:{" "}
                {new Date(app.lastUsedAt).toLocaleString("ru-RU")}
              </p>
              <button
                disabled={busy}
                className={button}
                onClick={() => void revoke(app.id)}
              >
                Отключить
              </button>
            </article>
          ))
        ) : (
          <p>
            Пока нет подключённых приложений. Они появятся здесь после первого
            входа через TZ ID и вашего согласия.
          </p>
        )
      ) : (
        <>
          <button
            disabled={busy}
            className={button}
            onClick={() => void revoke()}
          >
            Завершить другие сеансы
          </button>
          {sessions.map((row) => (
            <article
              key={row.id}
              className="border-t border-neutral-200 dark:border-white/10 pt-4 space-y-2"
            >
              <h3 className="font-medium break-all">
                {row.source || "TrioZ"} ·{" "}
                {row.current ? "Этот сеанс" : "Другой сеанс"}
              </h3>
              <p className="text-sm break-all text-neutral-600 dark:text-gray-400">
                {row.userAgent || "Неизвестное устройство"}
              </p>
              <p className="text-sm">
                {row.ip || "IP неизвестен"} ·{" "}
                {new Date(row.lastUsed).toLocaleString("ru-RU")}
              </p>
              <button
                disabled={busy}
                className={button}
                onClick={() => void revoke(row.id, row.current)}
              >
                Завершить{row.current ? " и выйти" : ""}
              </button>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
