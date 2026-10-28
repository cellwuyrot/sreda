"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import ManualSubscriptionGrant from "@/components/admin/ManualSubscriptionGrant";
import { hasPremium } from "@/lib/premium";
import { hasActiveVpnPlan } from "@/lib/vpnPlan";
import { useAdminBackHref, useAdminBackLabel } from "@/components/admin/useAdminBackHref";

interface Connection {
  accessSource?: string; id: string; title: string; accessKind: string; status: string; paidUntil: string; manualState: string;
}
interface User {
  manualGrants?: { id: string; kind: string; status: string; expiresAt: string | null; note: string | null }[]; id: string; name: string; username: string; email?: string; role: string;
  isPremium: boolean; vpnAccess: boolean; vpnAccessUntil: string | null; connections: Connection[];
}
const statuses: Record<string, string> = { ACTIVE: "Доступ действует", EXPIRED: "Срок завершён", PENDING: "Ожидает подключения" };
function date(value: string) { return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }); }

export default function AdminPremiumPage() {
  const { data: session } = useSession();
  const backHref = useAdminBackHref(), backLabel = useAdminBackLabel();
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1), [pages, setPages] = useState(1), [total, setTotal] = useState(0);
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true);
  const [error, setError] = useState(false), [truncated, setTruncated] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState("");
  const role = session?.user?.role;
  useEffect(() => {
    if (role !== "ADMIN" && role !== "EDITOR") return;
    const controller = new AbortController();
    setLoading(true); setError(false);
    const timeout = setTimeout(() => controller.abort(), 15000);
    const debounce = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/user-subscriptions?${new URLSearchParams({ page: String(page), q: query })}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("load");
        const data = await response.json();
        if (controller.signal.aborted) return;
        setUsers(data.users); setPage(data.page); setPages(data.pages); setTotal(data.total);
        setRefreshedAt(data.refreshedAt); setTruncated(data.truncated);
      } catch { if (!disposed) setError(true); }
      finally { if (!disposed) { clearTimeout(timeout); setLoading(false); } }
    }, 200);
    let disposed = false;
    return () => { disposed = true; clearTimeout(debounce); clearTimeout(timeout); controller.abort(); };
  }, [role, query, page, reload]);
  useEffect(() => {
    if (role !== "ADMIN" && role !== "EDITOR") return;
    const refresh = () => { if (document.visibilityState === "visible") setReload(n => n + 1); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [role]);
  if (role !== "ADMIN" && role !== "EDITOR") return null;
  return <main className="min-h-screen bg-neutral-50 px-4 py-8 text-neutral-900 dark:bg-dark-900 dark:text-white">
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <Link href={backHref} className="text-sm underline">{backLabel}</Link>
        <h1 className="mt-3 text-3xl font-bold">Подписки пользователей</h1>
        <p className="mt-2 text-neutral-600 dark:text-gray-300">Оплата — в Business. Здесь — права пользователей и подключения из общего каталога Business и TZ ID.</p>
      </header>
      <section className="rounded-2xl border border-neutral-200 p-4 dark:border-white/15">
        <p>Данные обновляются каждые 30 секунд и при возвращении в окно. Оплаченный доступ появляется после подтверждения банка и синхронизации из Business. Доверительный доступ и ручные назначения отмечаются отдельно.</p>
        <p className="mt-2 text-sm text-neutral-600 dark:text-gray-300">Premium включает надёжное соединение. Ранее выданные права сохранены. На trioz.ru оплата и подтверждение банковских операций не выполняются.</p>
        <div className="mt-3 flex flex-wrap gap-4">
          <a href="https://business.trioz.ru/admin/service-hub" target="_blank" rel="noopener noreferrer" className="underline">Управлять услугами в Business ↗</a>
          {role === "ADMIN" && <Link href="/tz-id/services" className="underline">Услуги и доступ в TZ ID</Link>}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label="Поиск пользователей" placeholder={role === "ADMIN" ? "Имя, логин или email" : "Имя или логин"} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-transparent px-4 py-3 dark:border-white/20" />
        <button onClick={() => setReload(n => n + 1)} disabled={loading} className="rounded-xl bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{loading ? "Обновление…" : "Обновить"}</button>
      </div>
      {refreshedAt && <p className="text-sm text-neutral-600 dark:text-gray-300">Пользователей: {total} · Обновлено: {date(refreshedAt)}</p>}
      {error ? <p role="alert" className="rounded-xl border border-red-400 p-4">Не удалось обновить подписки. Это не означает, что доступ закончился. Нажмите «Обновить».</p> : loading ? <p role="status">Загрузка подписок…</p> : <>
        {truncated && <p role="status">Показаны последние 1000 подключений на этой странице. Уточните поиск пользователя.</p>}
        {!users.length && <p className="rounded-xl border border-neutral-300 p-4 dark:border-white/20">Пользователи не найдены.</p>}
        <div className="space-y-4">{users.map(user => {
          const premium = hasPremium(user), vpn = premium || hasActiveVpnPlan(user);
          return <article key={user.id} className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-white/15 dark:bg-white/5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold">{user.name || user.username}</h2><p className="break-all text-sm text-neutral-600 dark:text-gray-300">@{user.username}{user.email ? ` · ${user.email}` : ""}</p></div>
              <p className="text-sm">Premium: <strong>{premium ? "Есть" : "Нет"}</strong> · Соединение: <strong>{vpn ? "Есть" : "Нет"}</strong></p>
            </div>
            {user.role === "ADMIN" && <p className="mt-2 text-sm">Доступ по роли администратора — покупка не требуется.</p>}
            <h3 className="mt-4 font-medium">Подключения Business / TZ ID</h3>
            {user.connections.length ? <ul className="mt-2 space-y-3">{user.connections.map(c => <li key={c.id} className="rounded-xl bg-neutral-100 p-3 dark:bg-black/20">
              <p className="font-medium">{c.title}</p>
              <p className="mt-1 text-sm">{c.accessSource === "TRUST" && c.status === "ACTIVE" ? "Доверительный доступ — оплата ожидается" : statuses[c.status] || "Требуется проверка"} · до {date(c.paidUntil)}</p>
              <p className="mt-1 text-sm text-neutral-600 dark:text-gray-300">{c.accessKind === "PREMIUM" ? "Premium, включая соединение" : c.accessKind === "VPN" ? "Надёжное соединение" : "Услуга с ручным исполнением"}{c.manualState === "ACTIVATION_PENDING" ? " · ожидает подключения исполнителем" : c.manualState === "DEACTIVATION_PENDING" ? " · ожидает отключения исполнителем" : ""}</p>
            </li>)}</ul> : <p className="mt-2 text-sm text-neutral-600 dark:text-gray-300">Подключений из Business пока нет.{premium || vpn ? " Действуют ранее выданные права или доступ по роли." : " Подписка не подключена."}</p>}
            {role === "ADMIN" && <ManualSubscriptionGrant userId={user.id} grants={user.manualGrants || []} onChanged={() => setReload(n => n + 1)} />}
          </article>;
        })}</div>
      </>}
      <nav aria-label="Страницы пользователей" className="flex items-center justify-between gap-3">
        <button disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)} className="rounded-xl border px-4 py-2 disabled:opacity-40">Назад</button>
        <span>{page} / {pages}</span>
        <button disabled={page >= pages || loading} onClick={() => setPage(p => p + 1)} className="rounded-xl border px-4 py-2 disabled:opacity-40">Далее</button>
      </nav>
    </div>
  </main>;
}
