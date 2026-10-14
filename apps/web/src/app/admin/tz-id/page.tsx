"use client";
import { useEffect, useState } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import Link from "next/link";
type Client = {
  id: string;
  name: string;
  enabled: boolean;
  redirectUris: string[];
  publicClient: boolean;
};
export default function TZIdAdmin() {
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [uris, setUris] = useState("");
  const [publicClient, setPublicClient] = useState(false);
  const [offlineAccess, setOfflineAccess] = useState(false);
  const [result, setResult] = useState<{
    clientId: string;
    clientSecret?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const res = await fetch("/api/admin/tz-id", { cache: "no-store" });
    if (!res.ok) throw new Error("Нет доступа или TZ ID не настроен");
    setClients(await res.json());
  }
  useEffect(() => {
    fetch("/api/admin/tz-id", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Нет доступа или TZ ID не настроен");
        setClients(await res.json());
      })
      .catch((e) => setError(e.message));
  }, []);
  const input =
    "w-full min-h-[44px] rounded-lg border border-neutral-300 dark:border-white/20 bg-transparent px-3 py-2";
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <Link href="/admin" className="underline">
        ← Администрирование
      </Link>
      <h1 className="text-2xl font-semibold">Приложения TZ ID</h1>
      <p>
        Только Authorization Code + PKCE S256. Без wildcard, передачи паролей и
        ролей TrioZ.
      </p>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <form
        className="rounded-xl border border-neutral-200 dark:border-white/15 p-5 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setResult(null);
          try {
            const res = await fetch("/api/admin/tz-id", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name,
                redirectUris: uris
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                publicClient,
                offlineAccess,
              }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setResult(data);
            setName("");
            setUris("");
            await load();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="text-lg font-semibold">Зарегистрировать приложение</h2>
        <label className="block">
          Название
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
        </label>
        <label className="block">
          Redirect URI · один точный HTTPS адрес на строку
          <textarea
            className={input}
            value={uris}
            onChange={(e) => setUris(e.target.value)}
            required
            rows={3}
          />
        </label>
        <label className="flex gap-3 items-center min-h-[44px]">
          <input
            type="checkbox"
            checked={publicClient}
            onChange={(e) => setPublicClient(e.target.checked)}
          />
          Public client (SPA/мобильный, без client secret)
        </label>
        <label className="flex gap-3 items-center min-h-[44px]">
          <input
            type="checkbox"
            checked={offlineAccess}
            onChange={(e) => setOfflineAccess(e.target.checked)}
          />
          Разрешить offline_access (refresh token)
        </label>
        <button className={input} disabled={busy}>
          {busy ? "Создание…" : "Создать"}
        </button>
      </form>
      {result && (
        <section className="rounded-xl border border-amber-400 p-5 space-y-3">
          <h2 className="font-semibold">Сохраните реквизиты сейчас</h2>
          <p>
            Секрет показывается только после создания. Храните его на сервере
            приложения, не в браузере и не в git.
          </p>
          <pre className="whitespace-pre-wrap break-all text-sm">
            {JSON.stringify(result, null, 2)}
          </pre>
          <button className={input} onClick={() => setResult(null)}>
            Скрыть реквизиты
          </button>
        </section>
      )}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Зарегистрированные приложения</h2>
        {clients.map((client) => (
          <article
            key={client.id}
            className="rounded-xl border border-neutral-200 dark:border-white/15 p-5 space-y-3"
          >
            <h3 className="font-semibold">
              {client.name} · {client.enabled ? "включено" : "отключено"}
            </h3>
            <p className="text-sm break-all">
              {client.id} · {client.publicClient ? "public" : "confidential"}
            </p>
            {client.redirectUris.map((uri) => (
              <p key={uri} className="text-sm break-all">
                {uri}
              </p>
            ))}
            <button
              className={input}
              disabled={busy}
              onClick={async () => {
                if (
                  !client.enabled ||
                  (await confirmDialog({
                    title: "Отключить приложение?",
                    message:
                      "Все выданные разрешения приложения будут отозваны.",
                    confirmText: "Отключить",
                    danger: true,
                  }))
                ) {
                  setBusy(true);
                  try {
                    const res = await fetch("/api/admin/tz-id", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        id: client.id,
                        enabled: !client.enabled,
                      }),
                    });
                    if (!res.ok) throw new Error("Ошибка обновления");
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }
              }}
            >
              {client.enabled ? "Отключить и отозвать доступ" : "Включить"}
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}
