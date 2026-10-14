"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import CooperationButton from "@/components/connect/CooperationButton";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

type Profile = {
  id: string;
  name: string;
  username: string;
  email: string;
  contactAddress: string | null;
};
type App = {
  id: string;
  name: string;
  notificationsEnabled: boolean;
  scopes: string[];
};
type Subscription = {
  id: string;
  title: string;
  projectName: string;
  status: string;
  expiresAt: string | null;
};
type Notice = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  body: string;
  url: string | null;
  readAt: string | null;
  read: boolean;
};
type Snapshot = {
  profile: Profile;
  applications: App[];
  subscriptions: Subscription[];
  notifications: Notice[];
};
const tabs = {
  profile: "Профиль",
  subscriptions: "Подписки",
  applications: "Сервисы и сайты",
  addresses: "Адреса",
  notifications: "Уведомления",
  security: "Безопасность",
  cooperation: "Сотрудничество",
};
const card =
  "rounded-xl border border-neutral-200 bg-white p-5 dark:border-white/15 dark:bg-neutral-900 space-y-3";
const input =
  "w-full min-h-[44px] rounded-lg border border-neutral-300 bg-transparent px-3 py-2 dark:border-white/25";
const button =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-neutral-300 px-4 py-2 dark:border-white/25 hover:bg-neutral-100 dark:hover:bg-white/10 disabled:opacity-50";
export default function TZIdHubPage() {
  const { data: session, status } = useSession();
  const [data, setData] = useState<Snapshot | null>(null);
  const [section, setSection] = useState<keyof typeof tabs>("profile");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [address, setAddress] = useState("");
  const [project, setProject] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function load() {
    const r = await fetch("/api/tz-id/hub", { cache: "no-store" });
    if (!r.ok)
      throw new Error(
        r.status === 401 ? "Войдите заново" : "Не удалось загрузить кабинет",
      );
    const snapshot: Snapshot = await r.json();
    setData(snapshot);
    setName(snapshot.profile.name);
    setUsername(snapshot.profile.username);
    setAddress(snapshot.profile.contactAddress || "");
  }
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("section");
    if (value && Object.hasOwn(tabs, value))
      setSection(value as keyof typeof tabs);
  }, []);
  useEffect(() => {
    if (!session?.user?.id) return;
    let active = true;
    fetch("/api/tz-id/hub", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Не удалось загрузить кабинет");
        const snapshot: Snapshot = await r.json();
        if (!active) return;
        setData(snapshot);
        setName(snapshot.profile.name);
        setUsername(snapshot.profile.username);
        setAddress(snapshot.profile.contactAddress || "");
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id]);
  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/tz-id/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "Не удалось сохранить");
      await load();
      setNotice("Изменения сохранены");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (status === "loading") return <main className="p-6">Загрузка…</main>;
  if (!session?.user?.id)
    return (
      <main className="max-w-xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-semibold">TZ ID</h1>
        <p>Войдите в аккаунт TrioZ, чтобы управлять общим профилем.</p>
        <Link className={button} href="/auth/signin?callbackUrl=%2Ftz-id">
          Войти
        </Link>
      </main>
    );
  return (
    <main className="max-w-6xl mx-auto px-4 py-8 pb-28 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="TrioZ"
            width="40"
            height="40"
            className="rounded-lg"
          />
          <h1 className="text-2xl font-semibold">TZ ID</h1>
        </div>
        <a href="https://id.trioz.ru" className={button}>
          Открыть id.trioz.ru
        </a>
      </header>
      <div className="grid md:grid-cols-[220px_minmax(0,1fr)] gap-6">
        <nav
          aria-label="Разделы TZ ID"
          className="grid grid-cols-2 gap-1 content-start md:grid-cols-1"
        >
          {Object.entries(tabs).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-current={section === key ? "page" : undefined}
              onClick={() => {
                setSection(key as keyof typeof tabs);
                setNotice("");
                setError("");
              }}
              className={`min-h-[44px] rounded-lg px-3 py-2 text-left ${section === key ? "bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200" : "hover:bg-neutral-100 dark:hover:bg-white/5"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <h2 className="text-xl font-semibold">{tabs[section]}</h2>
          {error && (
            <p role="alert" className="text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {loading && !data ? (
            <p>Загрузка данных…</p>
          ) : !data ? (
            <button
              className={button}
              onClick={() => {
                setLoading(true);
                load()
                  .catch((e) => setError(e.message))
                  .finally(() => setLoading(false));
              }}
            >
              Повторить
            </button>
          ) : (
            <>
              {section === "profile" && (
                <>
                  <section className={card}>
                    <h3 className="text-lg font-semibold">
                      {data.profile.name}
                    </h3>
                    <p>@{data.profile.username}</p>
                    <p className="break-all text-sm">
                      TZ ID: {data.profile.id}
                    </p>
                    <p>{data.profile.email}</p>
                    <p className="text-sm text-neutral-500">
                      Регистрация в TrioZ уже создаёт TZ ID. Второй аккаунт не
                      нужен.
                    </p>
                  </section>
                  <form
                    className={card}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save({ action: "profile", name, username });
                    }}
                  >
                    <label className="block">
                      Имя
                      <input
                        className={input}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        minLength={2}
                        maxLength={50}
                        required
                      />
                    </label>
                    <label className="block">
                      Ник
                      <input
                        className={input}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        maxLength={50}
                        required
                      />
                    </label>
                    <p className="text-sm text-neutral-500">
                      Действуют существующие правила смены ника в TrioZ.
                    </p>
                    <button disabled={busy} className={button}>
                      Сохранить
                    </button>
                    <Link
                      className={`${button} ml-2`}
                      href="/settings?section=tzid"
                    >
                      Аватар и email
                    </Link>
                  </form>
                </>
              )}
              {section === "addresses" && (
                <form
                  className={card}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save({ action: "profile", contactAddress: address });
                  }}
                >
                  <p>
                    Необязательный контактный адрес для связи. Проекты получают
                    его только с вашего разрешения.
                  </p>
                  <label className="block">
                    Контактный адрес
                    <textarea
                      rows={4}
                      className={input}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      maxLength={500}
                    />
                  </label>
                  <button disabled={busy} className={button}>
                    Сохранить
                  </button>
                </form>
              )}
              {section === "subscriptions" && (
                <>
                  <p className="text-sm text-neutral-500">
                    Подписки внешних проектов не дают Premium или VPN в TrioZ.
                    Оплата остаётся в проекте-источнике.
                  </p>
                  {data.subscriptions.map((s) => (
                    <section key={s.id} className={card}>
                      <p className="text-sm text-neutral-500">
                        {s.projectName}
                      </p>
                      <h3 className="font-semibold">{s.title}</h3>
                      <p>
                        {{
                          active: "Активна",
                          inactive: "Не подключена",
                          expired: "Истекла",
                          canceled: "Отменена",
                        }[s.status] || s.status}
                        {s.expiresAt
                          ? ` · до ${new Date(s.expiresAt).toLocaleDateString("ru-RU")}`
                          : ""}
                      </p>
                    </section>
                  ))}
                  <Link className={button} href="/settings?section=premium">
                    Управлять подписками TrioZ
                  </Link>
                </>
              )}
              {section === "applications" && (
                <>
                  {!data.applications.length && (
                    <p>Пока нет подключённых проектов.</p>
                  )}
                  {data.applications.map((a) => (
                    <section className={card} key={a.id}>
                      <h3 className="font-semibold">{a.name}</h3>
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          void save({
                            action: "notifications",
                            clientId: a.id,
                            enabled: !a.notificationsEnabled,
                          })
                        }
                      >
                        {a.notificationsEnabled ? "Отключить" : "Включить"}{" "}
                        уведомления
                      </button>
                      <button
                        className={`${button} ml-2`}
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await confirmDialog({
                              title: "Отключить проект?",
                              message:
                                "Выданный этому проекту доступ будет отозван.",
                              confirmText: "Отключить",
                            })
                          )
                            void save({ action: "disconnect", clientId: a.id });
                        }}
                      >
                        Отключить проект
                      </button>
                    </section>
                  ))}
                </>
              )}
              {section === "notifications" && (
                <>
                  <p className="text-sm text-neutral-500">
                    Последние 100 уведомлений от проектов.
                  </p>
                  <label className="block">
                    Проект
                    <select
                      className={input}
                      value={project}
                      onChange={(e) => setProject(e.target.value)}
                    >
                      <option value="">Все проекты</option>
                      {[
                        ...new Map(
                          data.notifications.map((n) => [
                            n.projectId,
                            n.projectName,
                          ]),
                        ).entries(),
                      ].map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {data.notifications
                    .filter((n) => !project || n.projectId === project)
                    .map((n) => (
                      <article className={card} key={n.id}>
                        <p className="text-sm text-neutral-500">
                          {n.projectName}
                        </p>
                        <h3 className="font-semibold">{n.title}</h3>
                        <p className="whitespace-pre-wrap break-words">
                          {n.body}
                        </p>
                        {n.url && (
                          <a
                            className={button}
                            href={n.url}
                            rel="noopener noreferrer"
                          >
                            Открыть проект
                          </a>
                        )}
                        {n.read ? (
                          <p>Прочитано</p>
                        ) : (
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() =>
                              void save({ action: "read", id: n.id })
                            }
                          >
                            Отметить прочитанным
                          </button>
                        )}
                      </article>
                    ))}
                  {!data.notifications.length && <p>Уведомлений пока нет.</p>}
                </>
              )}
              {section === "security" && (
                <>
                  <section className={card}>
                    <h3 className="font-semibold">Вход по QR-коду</h3>
                    <p>
                      На странице входа TZ ID в любом подключённом проекте
                      выберите QR-код. Откройте его на телефоне, войдите в TZ ID
                      и подтвердите название проекта и код.
                    </p>
                  </section>
                  <section className={card}>
                    <h3 className="font-semibold">
                      Двухфакторная аутентификация
                    </h3>
                    <p>
                      Пока недоступна. 2FA не включена; раздел подготовлен для
                      следующего этапа.
                    </p>
                  </section>
                  <Link className={button} href="/settings?section=security">
                    Пароль и сеансы
                  </Link>
                </>
              )}
              {section === "cooperation" && (
                <section className={card}>
                  <p>
                    Заявка попадёт в тот же раздел обращений и деловой чат, что
                    и из главного сообщества TZ.Connect.
                  </p>
                  <CooperationButton />
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
