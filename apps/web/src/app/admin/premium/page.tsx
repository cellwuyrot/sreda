"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { hasPremium } from "@/lib/premium";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import Spinner from "@/components/ui/Spinner";
import Link from "next/link";

import { useAdminBackHref, useAdminBackLabel } from "@/components/admin/useAdminBackHref"; // FIX-EDR2
interface PremiumUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  isPremium: boolean;
  banned: boolean;
}

interface Subscription {
  id: string;
  plan: string;
  paymentMethod: string;
  amount: number;
  currency: string;
  reference: string | null;
  note: string | null;
  status: string;
  startedAt: string;
  expiresAt: string | null;
  createdAt: string;
  grantedBy?: { username: string; name: string } | null;
}

const PLAN_LABELS: Record<string, string> = {
  month: "1 месяц",
  quarter: "3 месяца",
  year: "1 год",
  lifetime: "Бессрочно",
};
const METHOD_LABELS: Record<string, string> = {
  sbp: "СБП-перевод",
  acquiring: "Эквайринг",
  manual: "Вручную / офлайн",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ── Модалка: подключить подписку к платежу для конкретного клиента (ADMIN) ── */
function ConnectSubscriptionModal({
  user,
  priceMonth,
  enabledMethods,
  onClose,
  onConnected,
}: {
  user: PremiumUser;
  priceMonth: string;
  enabledMethods: string[];
  onClose: () => void;
  onConnected: (userId: string) => void;
}) {
  const [plan, setPlan] = useState<"month" | "quarter" | "year" | "lifetime">("month");
  const [method, setMethod] = useState<string>(enabledMethods[0] ?? "manual");
  const [amount, setAmount] = useState<string>(priceMonth || "");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Subscription[]>([]);

  const methodOptions = useMemo(() => {
    const base = ["sbp", "acquiring", "manual"];
    // Включённые способы — вперёд, но всегда показываем «Вручную».
    return base.sort((a, b) => Number(enabledMethods.includes(b)) - Number(enabledMethods.includes(a)));
  }, [enabledMethods]);

  useEffect(() => {
    fetch(`/api/admin/premium/subscriptions?userId=${user.id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => Array.isArray(data) && setHistory(data))
      .catch(() => {});
  }, [user.id]);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/premium/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          plan,
          paymentMethod: method,
          amount: Number(amount) || 0,
          reference: reference.trim() || null,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Не удалось подключить подписку");
        setSaving(false);
        return;
      }
      onConnected(user.id);
      onClose();
    } catch {
      setError("Ошибка сети. Попробуйте позже.");
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 max-w-lg w-full max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-white">Подписка + оплата</h3>
        <p className="text-sm text-gray-400 mt-1">
          Клиент: <span className="text-white font-medium">{user.name}</span> <span className="text-gray-500">@{user.username}</span>
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Тариф</label>
            <div className="grid grid-cols-4 gap-2">
              {(["month", "quarter", "year", "lifetime"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlan(p)}
                  className={`px-2 py-1.5 rounded-lg text-xs transition-all ${plan === p ? "bg-violet-500/25 text-violet-200 border border-violet-400/40" : "bg-dark-700 text-gray-400 border border-white/5 hover:border-white/20"}`}
                >
                  {PLAN_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-2 block">Способ оплаты</label>
            <div className="grid grid-cols-3 gap-2">
              {methodOptions.map((m) => {
                const on = method === m;
                const enabled = enabledMethods.includes(m) || m === "manual";
                return (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`px-2 py-1.5 rounded-lg text-xs transition-all ${on ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40" : "bg-dark-700 text-gray-400 border border-white/5 hover:border-white/20"}`}
                  >
                    {METHOD_LABELS[m]}
                    {!enabled && m !== "manual" && <span className="block text-[9px] text-gray-500">не настроен</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-400 mb-1 block">Сумма, ₽</label>
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="299" className="w-full bg-dark-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600" />
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-1 block">Номер платежа / чек</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Напр. чек СБП №…" className="w-full bg-dark-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600" />
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1 block">Комментарий</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Необязательно" className="w-full bg-dark-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 resize-none" />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {history.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs font-medium text-gray-300 mb-2">История подписок</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
                    <span>
                      <span className={h.status === "active" ? "text-emerald-400" : "text-gray-500"}>●</span>{" "}
                      {PLAN_LABELS[h.plan] ?? h.plan} · {METHOD_LABELS[h.paymentMethod] ?? h.paymentMethod} · {h.amount}₽
                    </span>
                    <span className="text-gray-500">{fmtDate(h.createdAt)} → {fmtDate(h.expiresAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={submit} disabled={saving} className="flex-1 px-4 py-2 bg-violet-500/20 text-violet-300 rounded-lg hover:bg-violet-500/40 transition-all text-sm font-medium disabled:opacity-50">
              {saving ? "Подключение..." : "Подключить и выдать Premium"}
            </button>
            <button onClick={onClose} className="flex-1 px-4 py-2 bg-dark-700 text-gray-400 rounded-lg hover:bg-dark-600 transition-all text-sm">
              Отмена
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function AdminPremiumPage() {
  // FIX-EDR2: редактору «Назад» ведёт в «Редакторскую», админу — в админку
  const backHref = useAdminBackHref();
  const backLabel = useAdminBackLabel();
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<PremiumUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [connectUser, setConnectUser] = useState<PremiumUser | null>(null);
  const [priceMonth, setPriceMonth] = useState("");
  const [enabledMethods, setEnabledMethods] = useState<string[]>([]);

  const isAdmin = session?.user?.role === "ADMIN";

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (Array.isArray(data)) setUsers(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.user?.role === "ADMIN" || session?.user?.role === "EDITOR") loadUsers();
  }, [session]);

  useEffect(() => {
    // Цена и включённые способы оплаты — для предзаполнения модалки подписки.
    if (session?.user?.role === "ADMIN") {
      fetch("/api/payments/methods")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setPriceMonth(data.priceMonth || "");
          setEnabledMethods(Array.isArray(data.methods) ? data.methods.map((m: { id: string }) => m.id) : []);
        })
        .catch(() => {});
    }
  }, [session]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((user) =>
      user.name.toLowerCase().includes(q) ||
      user.username.toLowerCase().includes(q) ||
      user.email.toLowerCase().includes(q)
    );
  }, [users, query]);

  const togglePremium = async (user: PremiumUser) => {
    setSavingId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPremium: !user.isPremium }),
      });
      if (res.ok) {
        const updated = await res.json();
        setUsers((prev) => prev.map((item) => item.id === user.id ? { ...item, isPremium: updated.isPremium } : item));
      }
    } finally {
      setSavingId(null);
    }
  };

  const markPremium = useCallback((userId: string) => {
    setUsers((prev) => prev.map((item) => item.id === userId ? { ...item, isPremium: true } : item));
  }, []);

  if (status === "loading" || loading) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  }

  if (session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") return null;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link href={backHref} className="text-sm text-accent hover:opacity-80">{backLabel}</Link>
            <h1 className="text-3xl font-bold text-white mt-2">Премиум</h1>
            <p className="text-gray-400 mt-1">Отдельный раздел для управления премиум-статусами, подписками и платежами.</p>
          </div>
          <div className="px-4 py-2 rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300 text-sm">
            Администраторы получают premium автоматически
          </div>
        </div>

        {isAdmin && (
          <div className="glass-card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Реквизиты для оплаты</h2>
              <p className="text-xs text-gray-400">Настройте СБП и интернет-эквайринг, на которые поступает оплата от клиентов.</p>
            </div>
            <Link href="/admin/payments" className="shrink-0 rounded-xl px-4 py-2 text-xs font-medium bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors">
              Открыть платёжные реквизиты →
            </Link>
          </div>
        )}

        <div className="glass-card p-5 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Выдача премиума</h2>
              <p className="text-sm text-gray-400">Премиум управляется отдельно от ролей пользователей.</p>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени, username или email"
              className="w-full sm:w-80 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 outline-none"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-white/10">
                  <th className="py-3 pr-4">Пользователь</th>
                  <th className="py-3 pr-4">Email</th>
                  <th className="py-3 pr-4">Статус</th>
                  <th className="py-3 pr-4">Доступ</th>
                  <th className="py-3">Действие</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const effectivePremium = hasPremium(user);
                  return (
                    <tr key={user.id} className="border-b border-white/5 text-gray-200">
                      <td className="py-3 pr-4">
                        <div>
                          <div className="font-medium text-white">{user.name}</div>
                          <div className="text-xs text-gray-400">@{user.username}</div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-gray-400">{user.email}</td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${effectivePremium ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-gray-400"}`}>
                          {effectivePremium ? "Premium" : "Обычный"}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-xs text-gray-400">
                        {user.role === "ADMIN" ? "Авто-premium по роли" : user.isPremium ? "Выдан вручную" : "Без премиума"}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {isAdmin && user.role !== "ADMIN" && (
                            <button
                              onClick={() => setConnectUser(user)}
                              className="rounded-xl px-3 py-2 text-xs font-medium bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                            >
                              Подписка + оплата
                            </button>
                          )}
                          <button
                            onClick={() => togglePremium(user)}
                            disabled={savingId === user.id || user.role === "ADMIN"}
                            className="rounded-xl px-3 py-2 text-xs font-medium bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {user.role === "ADMIN" ? "Назначается автоматически" : savingId === user.id ? "Сохранение..." : user.isPremium ? "Снять premium" : "Выдать premium"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {connectUser && (
          <ConnectSubscriptionModal
            user={connectUser}
            priceMonth={priceMonth}
            enabledMethods={enabledMethods}
            onClose={() => setConnectUser(null)}
            onConnected={markPremium}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
