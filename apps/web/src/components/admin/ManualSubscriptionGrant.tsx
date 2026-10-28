"use client";
import { useState } from "react";
type Grant = { id: string; kind: string; status: string; expiresAt: string | null; note: string | null };
export default function ManualSubscriptionGrant({ userId, grants, onChanged }: { userId: string; grants: Grant[]; onChanged: () => void }) {
  const [kind, setKind] = useState("VPN"), [months, setMonths] = useState(1), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  const field = "w-full rounded-xl border border-neutral-400 bg-transparent px-3 py-2 min-h-11";
  async function submit(action: string, grant?: Grant) {
    if (reason.trim().length < 5) { setError("Укажите основание: не менее 5 символов."); return; }
    setBusy(true); setError("");
    const request = requestId || crypto.randomUUID(); setRequestId(request);
    try {
      const r = await fetch("/api/admin/access-grants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, action, kind: grant?.kind || kind, months, reason, requestId: request, id: grant?.id }) });
      const data = await r.json(); if (!r.ok) throw Error(data.error || "Не удалось сохранить назначение");
      setRequestId(""); setReason(""); onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <details className="mt-4 rounded-xl border border-neutral-300 p-3 dark:border-white/20">
    <summary className="cursor-pointer py-2 font-medium">Ручная выдача и отзыв подписки</summary>
    <p className="mt-2 text-sm text-neutral-600 dark:text-gray-300">Без платежа. Ручное назначение не изменяет банковскую операцию. Отзыв снимает только выбранное назначение.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label>Услуга<select className={field} disabled={busy} value={kind} onChange={e => { setKind(e.target.value); setRequestId(""); }}><option value="VPN">Надёжное соединение</option><option value="PREMIUM">Premium, включая соединение</option></select></label>
      <label>Срок<select className={field} disabled={busy} value={months} onChange={e => { setMonths(Number(e.target.value)); setRequestId(""); }}>{[1, 3, 6, 12, 0].map(m => <option key={m} value={m}>{m ? `${m} мес.` : "Бессрочно"}</option>)}</select></label>
    </div>
    <label className="mt-3 block">Основание выдачи или отзыва<textarea className={`${field} mt-1`} disabled={busy} minLength={5} maxLength={1000} value={reason} onChange={e => { setReason(e.target.value); setRequestId(""); }} /></label>
    {error && <p role="alert" className="mt-2 text-red-600 dark:text-red-300">{error}</p>}
    <button className="mt-3 min-h-11 rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={() => void submit("grant")}>{busy ? "Сохранение…" : "Выдать / продлить вручную"}</button>
    {!!grants.length && <ul className="mt-4 space-y-3">{grants.map(g => <li key={g.id} className="rounded-xl bg-neutral-100 p-3 dark:bg-black/20"><p>{g.kind === "VPN" ? "Соединение" : "Premium"} · {g.status === "active" ? g.expiresAt && new Date(g.expiresAt) <= new Date() ? "Срок завершён" : "Действует" : "Отозвано"} · {g.expiresAt ? `до ${new Date(g.expiresAt).toLocaleDateString("ru-RU")}` : "Бессрочно"}</p><p className="mt-1 break-words text-sm">{g.note}</p>{g.status === "active" && <button disabled={busy} className="mt-2 min-h-11 rounded-xl border border-red-400 px-3 py-2" onClick={() => { if (window.confirm("Отозвать только это ручное назначение? Другие права сохранятся.")) void submit("revoke", g); }}>Отозвать назначение</button>}</li>)}</ul>}
  </details>;
}
