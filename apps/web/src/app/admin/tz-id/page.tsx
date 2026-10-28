"use client";
import { useEffect, useState } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import Link from "next/link";
import TzProjectAdmins from "@/components/admin/TzProjectAdmins";
import TzClientFields, { clientInputClass as input, draftPayload, type ClientDraft } from "@/components/admin/TzClientFields";
type Client = { id: string; name: string; enabled: boolean; redirectUris: string[]; publicClient: boolean; offlineAccess: boolean; apiScopes: string[]; revision: string };
const empty: ClientDraft = { name: "", uris: "", publicClient: false, offlineAccess: false, apiScopes: [] };
export default function TZIdAdmin() {
  const [clients, setClients] = useState<Client[]>([]), [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<ClientDraft>(empty), [editing, setEditing] = useState<Client | null>(null), [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ clientId: string; clientSecret?: string } | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  async function load(signal?: AbortSignal) {
    const res = await fetch("/api/admin/tz-id", { cache: "no-store", signal });
    if (!res.ok) throw new Error("Не удалось загрузить приложения. Проверьте доступ администратора.");
    const rows = await res.json(); if (!signal?.aborted) setClients(rows);
  }
  useEffect(() => { const controller = new AbortController(); load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  function startEdit(client: Client) { setEditing(client); setCreating(false); setError(""); setNotice(""); setDraft({ name: client.name, uris: client.redirectUris.join("\n"), publicClient: client.publicClient, offlineAccess: client.offlineAccess, apiScopes: client.apiScopes || [] }); }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const settings = draftPayload(draft);
    if (editing && (JSON.stringify(settings.redirectUris) !== JSON.stringify(editing.redirectUris) || (editing.offlineAccess && !settings.offlineAccess) || editing.apiScopes.some(s => !settings.apiScopes.includes(s)))) {
      if (!await confirmDialog({ title: "Сохранить изменения доступа?", message: "Изменение адресов возврата или уменьшение разрешений завершит выданный этому приложению доступ. Пользователям потребуется войти заново. Идентификатор, секрет и назначения администраторов сохранятся.", confirmText: "Сохранить", danger: true })) return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/admin/tz-id", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { id: editing.id, revision: editing.revision, settings } : { ...settings, publicClient: draft.publicClient }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Не удалось сохранить приложение");
      if (!editing) setResult(data);
      setEditing(null); setCreating(false); setDraft(empty);
      setNotice("Настройки сохранены. Новые разрешения действуют после повторного входа пользователя и его согласия.");
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function toggle(client: Client) {
    if (busy) return;
    if (client.enabled && !await confirmDialog({ title: `Отключить «${client.name}»?`, message: "Вход в приложение будет запрещён, а выданный доступ отозван. Повторное включение не восстановит старые сеансы.", confirmText: "Отключить", danger: true })) return;
    setBusy(true); setError(""); setNotice("");
    try { const res = await fetch("/api/admin/tz-id", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: client.id, enabled: !client.enabled }) }); if (!res.ok) throw new Error("Не удалось изменить доступ приложения"); await load(); setNotice(client.enabled ? "Приложение отключено, доступ отозван." : "Приложение включено. Пользователи могут войти заново."); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="max-w-5xl mx-auto px-4 py-6 sm:p-8 space-y-6 text-base leading-relaxed">
    <Link href="/admin" className="inline-flex items-center min-h-[44px] underline">← Администрирование</Link>
    <header className="space-y-2"><h1 className="text-3xl font-semibold">TZ ID · вход в ваши проекты</h1><p className="max-w-2xl text-neutral-600 dark:text-neutral-300">Подключайте сайты к единому аккаунту, управляйте их доступом и назначайте администраторов. Настройки существующих приложений можно изменить без замены ключей.</p></header>
    {error && <div role="alert" className="rounded-lg border border-red-400 p-4 space-y-2"><p>{error}</p><button className="underline min-h-[44px]" disabled={busy} onClick={async () => { setError(""); try { await load(); setEditing(null); setCreating(false); } catch (e) { setError((e as Error).message); } }}>Обновить список</button></div>}
    {notice && <p role="status" className="rounded-lg border border-green-500 p-4">{notice}</p>}
    <section className="space-y-4" aria-label="Подключённые приложения">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Подключённые приложения{!loading && ` · ${clients.length}`}</h2><button className="min-h-[44px] rounded-lg bg-blue-600 text-white px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => { setEditing(null); setCreating(true); setDraft(empty); setError(""); setNotice(""); }}>Добавить приложение</button></div>
      {loading && <p role="status">Загрузка приложений…</p>}
      {!loading && !error && clients.length === 0 && <p className="rounded-xl border p-5">Пока нет подключённых приложений. Добавьте первое, чтобы пользователи могли входить через TZ ID.</p>}
      {creating && <form onSubmit={save} className="rounded-xl border border-blue-500 p-5 space-y-5"><h3 className="text-xl font-semibold">Новое приложение</h3><TzClientFields value={draft} onChange={setDraft} creating disabled={busy}/><div className="flex flex-wrap gap-3"><button className="min-h-[44px] rounded-lg bg-blue-600 text-white px-4 py-2" disabled={busy}>{busy ? "Создание…" : "Создать приложение"}</button><button type="button" className="min-h-[44px] px-4 underline" disabled={busy} onClick={() => setCreating(false)}>Отмена</button></div></form>}
      {clients.map(client => <article key={client.id} className="rounded-xl border border-neutral-300 dark:border-white/20 p-5 space-y-4 min-w-0">
        <div className="flex flex-wrap gap-3 items-center justify-between"><h3 className="text-lg font-semibold break-all max-w-full">{client.name}</h3><span className={`text-sm rounded-md px-2 py-1 ${client.enabled ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-neutral-100 dark:bg-neutral-800"}`}>{client.enabled ? "Вход разрешён" : "Вход отключён"}</span></div>
        {editing?.id === client.id ? <form onSubmit={save} className="space-y-5"><TzClientFields value={draft} onChange={setDraft} disabled={busy}/><div className="flex flex-wrap gap-3"><button className="min-h-[44px] rounded-lg bg-blue-600 text-white px-4 py-2" disabled={busy}>{busy ? "Сохранение…" : "Сохранить изменения"}</button><button type="button" className="min-h-[44px] px-4 underline" disabled={busy} onClick={() => setEditing(null)}>Отмена</button></div></form> : <><p className="text-neutral-600 dark:text-neutral-300">{client.publicClient ? "Мобильное приложение / без сервера" : "Сайт с сервером"} · {client.offlineAccess ? "Продление входа разрешено" : "Продление входа выключено"}</p><p className="text-sm text-neutral-600 dark:text-neutral-300">{client.redirectUris.length} адрес(а) возврата · {client.apiScopes?.length || 0} дополнительных разрешений</p><div className="flex flex-wrap gap-3"><button className="min-h-[44px] border border-neutral-500 rounded-lg px-4 py-2" disabled={busy} onClick={() => startEdit(client)}>Настроить</button><button className="min-h-[44px] px-4 py-2 underline" disabled={busy} onClick={() => void toggle(client)}>{client.enabled ? "Отключить вход" : "Включить вход"}</button></div></>}
        <details><summary className="cursor-pointer min-h-[44px] py-2 text-sm">Данные для разработчика</summary><dl className="text-sm space-y-2 min-w-0"><dt>Идентификатор приложения (Client ID)</dt><dd className="font-mono break-all">{client.id}</dd><dt>Адреса возврата</dt>{client.redirectUris.map(uri => <dd key={uri} className="break-all">{uri}</dd>)}</dl></details>
      </article>)}
    </section>
    {result && <section role="status" className="rounded-xl border border-amber-500 p-5 space-y-3"><h2 className="text-lg font-semibold">Сохраните ключи нового приложения</h2><p>Секрет показывается только сейчас. Передайте его разработчику безопасным способом. Не публикуйте в Git и не отправляйте в чат.</p><pre className="whitespace-pre-wrap break-all text-sm">{JSON.stringify(result, null, 2)}</pre><button className={input} onClick={() => setResult(null)}>Скрыть ключи</button></section>}
    <details className="border-t border-neutral-300 dark:border-white/20 pt-4"><summary className="cursor-pointer min-h-[44px] py-2 text-xl font-semibold">Администраторы проектов</summary><p className="my-3 text-neutral-600 dark:text-neutral-300">Выберите приложение и назначьте людей, которым разрешено управлять именно этим проектом.</p><TzProjectAdmins clients={clients} refresh={load}/></details>
  </main>;
}
