"use client";
import { useEffect, useState } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
type Client = { id: string; name: string; publicClient: boolean; enabled: boolean; apiScopes?: string[] };
type Grant = { userId: string; user: { name: string; username: string } };
export default function TzProjectAdmins({ clients, refresh }: { clients: Client[]; refresh: () => Promise<void> }) {
  const [clientId, setClientId] = useState("");
  const [userId, setUserId] = useState("");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const client = clients.find(c => c.id === clientId);
  const input = "w-full min-h-[44px] rounded-lg border border-neutral-500 dark:border-white/40 bg-transparent px-3 py-2";
  useEffect(() => {
    setGrants([]); setError(""); setLoaded(false);
    if (!clientId) return;
    const controller = new AbortController();
    fetch(`/api/admin/tz-id/project-admins?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store", signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error("Не удалось загрузить администраторов"); const rows = await r.json(); if (!controller.signal.aborted) { setGrants(rows); setLoaded(true); } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [clientId]);
  async function assign(subject: string, enabled: boolean) {
    if (!client || !loaded || busy) return;
    if (!await confirmDialog({ title: enabled ? "Назначить администратора проекта?" : "Отозвать права проекта?", message: `${client.name} · TZ ID: ${subject}. ${enabled ? "Пользователь получит полную админку этого проекта. Проверьте ID." : "Следующая серверная проверка перестанет давать административный доступ."}`, confirmText: enabled ? "Назначить" : "Отозвать", danger: true })) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/tz-id/project-admins", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, userId: subject, enabled }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      const rows = await fetch(`/api/admin/tz-id/project-admins?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
      if (!rows.ok) throw new Error("Права изменены, но список не обновлён. Выберите приложение заново.");
      setGrants(await rows.json()); setUserId("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-neutral-200 dark:border-white/15 p-5 space-y-4">
    <h2 className="text-lg font-semibold">Администраторы проектов</h2>
    <p className="text-sm">Назначение относится только к выбранному приложению. Глобальная роль TrioZ не передаётся. Для Business оно открывает полноценную админку после входа через TZ ID.</p>
    <label htmlFor="tz-role-client" className="block">Приложение</label><select id="tz-role-client" className={input} value={clientId} disabled={busy} onChange={e => setClientId(e.target.value)}><option value="">Выберите приложение</option>{clients.filter(c => !c.publicClient).map(c => <option key={c.id} value={c.id}>{c.name}{c.enabled ? "" : " (отключено)"}</option>)}</select>
    {client && !client.apiScopes?.includes("roles:read") && <div className="space-y-2"><p className="text-sm">Разрешите приложению проверять права администратора. После изменения пользователь должен войти заново и дать согласие.</p><button type="button" className={input} disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const r = await fetch("/api/admin/tz-id", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: client.id, projectRoles: true }) }); if (!r.ok) throw new Error("Не удалось разрешить проверку прав"); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Разрешить проверку прав администратора</button></div>}
    {client && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void assign(userId.trim(), true); }}><label htmlFor="tz-role-user" className="block">Идентификатор пользователя TZ ID (не email)</label><input id="tz-role-user" className={input} value={userId} onChange={e => setUserId(e.target.value)} required maxLength={100} disabled={busy}/><button className={input} disabled={busy || !loaded || !client.enabled || !client.apiScopes?.includes("roles:read")}>Назначить администратора</button></form>}
    {client && !loaded && !error && <p role="status">Загрузка…</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {loaded && grants.length === 0 && <p>Администраторы этому приложению не назначены.</p>}
    {grants.map(g => <div key={g.userId} className="border-t border-neutral-200 dark:border-white/15 pt-3 space-y-2"><p>{g.user.name} · @{g.user.username}</p><p className="text-sm break-all">TZ ID: {g.userId}</p><button type="button" className={input} disabled={busy} onClick={() => void assign(g.userId, false)}>Отозвать права</button></div>)}
  </section>;
}
