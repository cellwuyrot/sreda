"use client";
​
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Spinner from "@/components/ui/Spinner";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import {
  formatAmount,
  formatSize,
  isPaid,
  statusLabel,
  type PaymentStatus,
  type ServiceDocument,
} from "@/lib/businessPayment";
/* BUSINESS-SUB: счёт теперь бывает разовым и подписным. */
import {
  describeTerms,
  formatDueDate,
  isSubscription,
  periodLabel,
  type BillingPeriod,
  type PaymentMode,
} from "@/lib/businessPaymentFlow";
​
/**
 * BUSINESS-PAY: подраздел «Бизнес» в «Админ → Пользователи».
 *
 * Здесь администрация готовит форму оплаты по деловому обращению и подтверждает
 * поступление денег. Сами договоры здесь НЕ сочиняются: они привязаны к услуге
 * («Сервисы и система» → документы услуги) и подтягиваются в счёт вместе с выбором
 * услуги — снимком на момент выставления.
 *
 * Сумма хранится в копейках, а вводится в рублях: дробные деньги в числах с
 * плавающей точкой — классический способ потерять копейку на округлении.
 */
​
interface PaymentRow {
  id: string;
  title: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  mode: PaymentMode;
  period: BillingPeriod | null;
  cycles: number | null;
  paidCycles: number;
  nextDueAt: string | null;
  serviceId: string | null;
  serviceTitle: string | null;
  description: string | null;
  requisites: string | null;
  documents: ServiceDocument[];
  signedAt: string | null;
  signedName: string | null;
  declaredAt: string | null;
  declaredNote: string | null;
  paidAt: string | null;
  contractCount: number;
}
​
interface ConversationRow {
  id: string;
  appealId: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  client: { id: string; name: string | null; username: string | null; email: string | null; avatar: string | null };
  handlerName: string | null;
  payment: PaymentRow | null;
}
​
interface ServiceRow {
  id: string;
  title: string;
  documentCount: number;
}
​
function StatusPill({ status }: { status: PaymentStatus }) {
  const paid = isPaid(status);
  const awaiting = status === "AWAITING";
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[11px] ${
        paid
          ? "bg-green-500/15 text-green-300"
          : awaiting
            ? "bg-amber-500/15 text-amber-300"
            : "bg-white/10 text-gray-400"
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}
​
export default function AdminBusiness() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [editing, setEditing] = useState<ConversationRow | null>(null);
​
  /* Поиск с задержкой: без неё каждая буква была бы отдельным запросом к базе. */
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);
​
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/business${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось загрузить данные");
      setConversations(data.conversations ?? []);
      setServices(data.services ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [debounced]);
​
  useEffect(() => {
    void load();
  }, [load]);
​
  async function setStatus(conversationId: string, status: PaymentStatus) {
    if (status === "PAID") {
      const ok = await confirmDialog({
        message: "Подтвердить поступление оплаты? Клиенту откроется раздел подписанных договоров.",
        confirmText: "Подтвердить",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось изменить статус");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
​
  if (loading) {
    return <div className="py-16 flex justify-center"><Spinner /></div>;
  }
​
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по клиенту…"
          className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-gray-500 outline-none focus:border-cyan-500/50"
        />
        <span className="text-xs text-gray-500 whitespace-nowrap">{conversations.length} обращений</span>
      </div>
​
      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
​
      {conversations.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">Деловых обращений пока нет</p>
      ) : (
        <div className="space-y-3">
          {conversations.map((c) => (
            <div key={c.id} className="glass-card p-4">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">
                      {c.client.name || c.client.username || "Без имени"}
                    </span>
                    {c.payment ? <StatusPill status={c.payment.status} /> : (
                      <span className="px-2 py-0.5 rounded-full text-[11px] bg-white/10 text-gray-400">Счёт не выставлен</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {c.client.email ?? "—"}
                    {c.handlerName ? ` · ведёт: ${c.handlerName}` : ""}
                  </p>
                  {c.payment && (
                    <p className="text-xs text-gray-400 mt-1">
                      {c.payment.title} · {formatAmount(c.payment.amount, c.payment.currency)}
                      {c.payment.serviceTitle ? ` · ${c.payment.serviceTitle}` : ""}
                      {c.payment.documents.length ? ` · документов: ${c.payment.documents.length}` : ""}
                      {c.payment.contractCount ? ` · договоров: ${c.payment.contractCount}` : ""}
                    </p>
                  )}
                  {/* BUSINESS-SUB: для подписки важна не столько сумма, сколько срок
                      следующего платежа и сколько периодов уже закрыто. */}
                  {c.payment && isSubscription({ mode: c.payment.mode }) && (
                    <p className="text-[11px] text-cyan-300/80 mt-0.5">
                      {describeTerms(
                        {
                          status: c.payment.status,
                          mode: c.payment.mode,
                          period: c.payment.period,
                          cycles: c.payment.cycles,
                          paidCycles: c.payment.paidCycles,
                          nextDueAt: c.payment.nextDueAt ? new Date(c.payment.nextDueAt) : null,
                        },
                        formatAmount(c.payment.amount, c.payment.currency),
                      )}
                      {c.payment.nextDueAt
                        ? ` · следующий платёж: ${formatDueDate(new Date(c.payment.nextDueAt))}`
                        : " · платежей больше нет"}
                      {` · оплачено периодов: ${c.payment.paidCycles}`}
                      {c.payment.cycles
                        ? ` из ${c.payment.cycles} (осталось ${Math.max(
                            0,
                            c.payment.cycles - c.payment.paidCycles,
                          )})`
                        : ""}
                    </p>
                  )}
                  {c.payment?.signedName && (
                    <p className="text-[11px] text-gray-500 mt-0.5">Подписал: {c.payment.signedName}</p>
                  )}
                  {c.payment?.status === "AWAITING" && (
                    <p className="text-[11px] text-amber-400 mt-0.5">
                      Клиент сообщил об оплате{c.payment.declaredNote ? `: ${c.payment.declaredNote}` : ""}
                    </p>
                  )}
                </div>
​
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300"
                  >
                    {c.payment ? "Изменить счёт" : "Выставить счёт"}
                  </button>
                  {c.payment && !isPaid(c.payment.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setStatus(c.id, "PAID")}
                      className="px-3 py-2 rounded-lg bg-green-500/15 hover:bg-green-500/25 text-xs text-green-300 disabled:opacity-40"
                    >
                      {isSubscription({ mode: c.payment.mode }) ? "Период оплачен" : "Оплата получена"}
                    </button>
                  )}
                  {c.payment && isPaid(c.payment.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setStatus(c.id, "UNPAID")}
                      className="px-3 py-2 rounded-lg bg-white/5 hover:bg-red-500/20 text-xs text-gray-400 hover:text-red-300 disabled:opacity-40"
                      title="Вернуть в неоплаченные"
                    >
                      Отменить
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
​
      <AnimatePresence>
        {editing && (
          <PaymentFormModal
            conversation={editing}
            services={services}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
​
/* ── Форма выставления счёта ────────────────────────────────────── */
​
function PaymentFormModal({
  conversation,
  services,
  onClose,
  onSaved,
}: {
  conversation: ConversationRow;
  services: ServiceRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const p = conversation.payment;
  const [serviceId, setServiceId] = useState(p?.serviceId ?? "");
  const [title, setTitle] = useState(p?.title ?? "");
  const [description, setDescription] = useState(p?.description ?? "");
  const [requisites, setRequisites] = useState(p?.requisites ?? "");
  /* BUSINESS-SUB: способ выставления. У подписки сумма — за один период. */
  const [mode, setMode] = useState<PaymentMode>(p?.mode ?? "ONE_TIME");
  const [period, setPeriod] = useState<BillingPeriod>(p?.period ?? "MONTH");
  /* Пустое поле = бессрочно, до отмены. */
  const [cycles, setCycles] = useState(p?.cycles ? String(p.cycles) : "");
  /* В поле — рубли, в базе — копейки. */
  const [amount, setAmount] = useState(p ? String(p.amount / 100) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
​
  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  );
​
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
​
  async function save() {
    const rub = Number(amount.replace(",", "."));
    if (!title.trim()) {
      setError("Укажите название счёта");
      return;
    }
    if (!Number.isFinite(rub) || rub < 0) {
      setError("Неверная сумма");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          serviceId: serviceId || null,
          title,
          description,
          requisites,
          amount: Math.round(rub * 100),
          mode,
          period: mode === "SUBSCRIPTION" ? period : null,
          cycles: mode === "SUBSCRIPTION" && cycles.trim() ? Number(cycles) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось сохранить");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
​
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 p-5 space-y-3"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-white">Форма оплаты</h3>
            <p className="text-xs text-gray-400 truncate">
              {conversation.client.name || conversation.client.username || "Клиент"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>
​
        {p && (
          <p className="text-[11px] text-amber-400">
            Счёт уже выставлен. Сохранение изменит условия и сбросит подпись клиента —
            ему придётся ознакомиться с документами заново.
          </p>
        )}
​
        <label className="block">
          <span className="text-xs text-gray-400">Услуга (отсюда берутся документы)</span>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white outline-none"
          >
            <option value="">Без услуги</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.documentCount} док.)
              </option>
            ))}
          </select>
          {selectedService && selectedService.documentCount === 0 && (
            <span className="block mt-1 text-[11px] text-amber-400">
              У этой услуги нет документов — добавьте их в «Сервисы и система».
            </span>
          )}
        </label>
​
        <label className="block">
          <span className="text-xs text-gray-400">Название счёта</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Разработка сайта, первый этап"
            className="mt-1 w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white outline-none"
          />
        </label>
​
        {/* BUSINESS-SUB: альтернативный счёт по системе подписки. */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-gray-400">Способ выставления</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value === "SUBSCRIPTION" ? "SUBSCRIPTION" : "ONE_TIME")}
              className="mt-1 w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white outline-none"
            >
              <option value="ONE_TIME">Разовый счёт</option>
              <option value="SUBSCRIPTION">Подписка</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">Период</span>
            <select
              value={period}
              disabled={mode !== "SUBSCRIPTION"}
              onChange={(e) => setPeriod(e.target.value as BillingPeriod)}
              className="mt-1 w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white outline-none disabled:opacity-40"
            >
              <option value="MONTH">Месяц</option>
              <option value="QUARTER">Квартал</option>
              <option value="YEAR">Год</option>
            </select>
          </label>
        </div>
​
        {mode === "SUBSCRIPTION" && (
          <label className="block">
            <span className="text-xs text-gray-400">Сколько периодов оплатить (пусто — бессрочно)</span>
            <input
              value={cycles}
              onChange={(e) => setCycles(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
              inputMode="numeric"
              placeholder="например, 12"
              className="mt-1 w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white outline-none"
            />
          </label>
        )}
​
        <label className="block">
          <span className="text-xs text-gray-400">
            {mode === "SUBSCRIPTION" ? `Сумма за один ${periodLabel(period)}, ₽` : "Сумма, ₽"}
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="mt-1 w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white outline-none"
          />
        </label>
​
        <label className="block">
          <span className="text-xs text-gray-400">Описание для клиента</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white outline-none resize-none"
          />
        </label>
​
        <label className="block">
          <span className="text-xs text-gray-400">Реквизиты для оплаты</span>
          <textarea
            value={requisites}
            onChange={(e) => setRequisites(e.target.value)}
            rows={3}
            placeholder="Счёт, НДС, назначение платежа…"
            className="mt-1 w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white outline-none resize-none"
          />
        </label>
​
        {p && p.documents.length > 0 && (
          <div className="text-[11px] text-gray-500">
            В текущем счёте документов: {p.documents.length}
            {" · "}
            {p.documents.map((d) => `${d.name} (${formatSize(d.size)})`).join(", ")}
          </div>
        )}
​
        {error && <p className="text-xs text-red-400">{error}</p>}
​
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Сохранение…" : "Сохранить и отправить клиенту"}
        </button>
      </motion.div>
    </motion.div>
  );
}
​