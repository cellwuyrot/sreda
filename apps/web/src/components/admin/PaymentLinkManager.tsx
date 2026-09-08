"use client";

import { useCallback, useEffect, useState } from "react";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import {
  PAYMENT_LINK_KINDS,
  PAYMENT_LINK_KIND_LABELS,
  PAYMENT_LINK_PLANS,
  PAYMENT_LINK_PLAN_LABELS,
  PAYMENT_LINK_STATUS_LABELS,
  type PaymentLinkKind,
  type PaymentLinkPlan,
  type PaymentLinkStats,
  type PaymentLinkStatus,
} from "@/lib/paymentLinkKinds";

/**
 * PAYLINK: пул платёжных ссылок банка в разделе «Платежи».
 *
 * ── Зачем ──────────────────────────────────────────────────
 *
 * Ссылка банка (https://b2b.cbrpay.ru/...) одноразовая: одна ссылка — одна
 * подписка. Поэтому администратор выписывает ссылки пачкой и складывает их в пул,
 * а сайт выдаёт из пула по одной и больше никому ту же ссылку не покажет.
 *
 * У банка нет обратного вызова на сайт: страница оплаты показывает успех только
 * плательщику. Поэтому цикл такой: свободна → выдана → плательщик нажал
 * «Я оплатил» → администратор сверил зачисление и подтвердил → подписка выдана.
 * Если в настройках выбран режим «Автоматически», шаг подтверждения пропускается.
 *
 * Состояния считает СЕРВЕР (поле stats): администратор должен видеть то же,
 * что в базе, а не браузерную копию подсчёта.
 */

const inputClass =
  "w-full px-3 py-2 rounded-xl text-sm bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30";
const labelClass = "block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1";
const cardClass =
  "bg-white dark:bg-neutral-800/50 rounded-2xl border border-neutral-200 dark:border-white/10 p-5";

interface LinkPerson {
  id?: string;
  username: string | null;
  name: string | null;
}

interface LinkRow {
  id: string;
  kind: PaymentLinkKind;
  plan: PaymentLinkPlan;
  amount: number;
  currency: string;
  url: string;
  label: string | null;
  status: PaymentLinkStatus;
  reservedAt: string | null;
  reservationExpiresAt: string | null;
  paidReportedAt: string | null;
  payerReference: string | null;
  usedAt: string | null;
  subscriptionId: string | null;
  note: string | null;
  createdAt: string;
  reservedBy: LinkPerson | null;
  usedBy: LinkPerson | null;
  confirmedBy: LinkPerson | null;
}

const EMPTY_STATS: PaymentLinkStats = {
  total: 0,
  free: 0,
  reserved: 0,
  awaiting: 0,
  used: 0,
  disabled: 0,
};

const STATUS_TONE: Record<PaymentLinkStatus, string> = {
  FREE: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  RESERVED: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  AWAITING: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  USED: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-300",
  DISABLED: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

function personName(person: LinkPerson | null): string {
  if (!person) return "—";
  return person.name || person.username || "без имени";
}

function moment(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export default function PaymentLinkManager() {
  const [kind, setKind] = useState<PaymentLinkKind>("PREMIUM");
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [stats, setStats] = useState<PaymentLinkStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<PaymentLinkStatus | "ALL">("ALL");

  /* Форма загрузки пачки ссылок. */
  const [plan, setPlan] = useState<PaymentLinkPlan>("month");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("RUB");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [bulk, setBulk] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payment-links?kind=${kind}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || `Ссылки не загрузились (HTTP ${res.status}).`);
        setLinks([]);
        setStats(EMPTY_STATS);
        return;
      }
      setLinks(Array.isArray(data?.links) ? data.links : []);
      setStats(data?.stats ?? EMPTY_STATS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ссылки не загрузились.");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addLinks() {
    if (!bulk.trim()) {
      setError("Вставьте хотя бы одну платёжную ссылку.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          plan,
          amount: Number(amount.replace(/[^\d]/g, "")) || 0,
          currency,
          label,
          note,
          links: bulk,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || `Ссылки не загружены (HTTP ${res.status}).`);
        return;
      }
      setBulk("");
      const parts = [`Добавлено: ${data?.created ?? 0}`];
      if (data?.skipped) parts.push(`уже было: ${data.skipped}`);
      if (data?.invalid) parts.push(`не разобрано: ${data.invalid}`);
      setNotice(data?.message ? String(data.message) : parts.join(" · "));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ссылки не загружены.");
    } finally {
      setSaving(false);
    }
  }

  async function act(linkId: string, action: "confirm" | "release" | "disable" | "enable") {
    if (action === "confirm") {
      const sure = await confirmDialog({
        title: "Подтвердить оплату?",
        message:
          "Подписка будет выдана плательщику сразу. Сначала сверьте зачисление средств в банке.",
        confirmText: "Подтвердить",
      });
      if (!sure) return;
    }
    setBusyId(linkId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/payment-links", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId, action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || `Действие не выполнено (HTTP ${res.status}).`);
        return;
      }
      if (action === "confirm") {
        setNotice(
          data?.subscriptionId
            ? `Подписка выдана и привязана к профилю до ${moment(data.expiresAt ?? null)}.`
            : "Подписка выдана.",
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Действие не выполнено.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(linkId: string) {
    const sure = await confirmDialog({
      title: "Удалить ссылку?",
      message: "Ссылка исчезнет из пула. Выданные подписки останутся на месте.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!sure) return;
    setBusyId(linkId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payment-links?id=${encodeURIComponent(linkId)}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || `Ссылка не удалена (HTTP ${res.status}).`);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ссылка не удалена.");
    } finally {
      setBusyId(null);
    }
  }

  const shown = filter === "ALL" ? links : links.filter((l) => l.status === filter);

  return (
    <div className="space-y-4">
      {/* Выбор подписки: у каждого типа свой пул ссылок. */}
      <div className="flex flex-wrap gap-2">
        {PAYMENT_LINK_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`px-3 py-1.5 rounded-xl text-sm border transition ${
              kind === k
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-neutral-50 dark:bg-white/5 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-white/10"
            }`}
          >
            {PAYMENT_LINK_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {/* Состояние пула. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {(
          [
            ["Всего", stats.total],
            ["Свободно", stats.free],
            ["Выдано", stats.reserved],
            ["Ждут проверки", stats.awaiting],
            ["Оплачено", stats.used],
            ["Отключено", stats.disabled],
          ] as Array<[string, number]>
        ).map(([title, value]) => (
          <div
            key={title}
            className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3 py-2"
          >
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{title}</div>
            <div className="text-lg font-semibold text-neutral-900 dark:text-white">{value}</div>
          </div>
        ))}
      </div>

      {stats.free === 0 && !loading && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          Свободных ссылок не осталось — новые плательщики не смогут оплатить. Выпишите ссылки в банке и добавьте их ниже.
        </div>
      )}

      {/* Загрузка пачки ссылок. */}
      <div className={cardClass}>
        <div className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">
          Добавить ссылки · {PAYMENT_LINK_KIND_LABELS[kind]}
        </div>
        <div className="grid sm:grid-cols-4 gap-3 mb-3">
          <div>
            <label className={labelClass}>Срок</label>
            <select className={inputClass} value={plan} onChange={(e) => setPlan(e.target.value as PaymentLinkPlan)}>
              {PAYMENT_LINK_PLANS.map((p) => (
                <option key={p} value={p}>
                  {PAYMENT_LINK_PLAN_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Сумма</label>
            <input
              className={inputClass}
              value={amount}
              inputMode="numeric"
              placeholder="199"
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
          <div>
            <label className={labelClass}>Валюта</label>
            <input
              className={inputClass}
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label className={labelClass}>Пометка</label>
            <input
              className={inputClass}
              value={label}
              placeholder="партия от 8 сентября"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        </div>
        <label className={labelClass}>Ссылки — по одной в строке</label>
        <textarea
          className={`${inputClass} font-mono text-xs`}
          rows={5}
          value={bulk}
          placeholder={"https://b2b.cbrpay.ru/AS1B0018GLHHOGPE9DKAVECOO0TREEQO"}
          onChange={(e) => setBulk(e.target.value)}
        />
        <div className="mt-2">
          <label className={labelClass}>Заметка для администраторов</label>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={addLinks} disabled={saving}>
            {saving ? "Загружаю…" : "Добавить в пул"}
          </Button>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Повторы и уже загруженные ссылки отбрасываются автоматически.
          </span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {/* Фильтр состояний. */}
      <div className="flex flex-wrap gap-2">
        {(["ALL", "AWAITING", "RESERVED", "FREE", "USED", "DISABLED"] as Array<PaymentLinkStatus | "ALL">).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`px-2.5 py-1 rounded-lg text-xs border transition ${
              filter === s
                ? "bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white"
                : "bg-neutral-50 dark:bg-white/5 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-white/10"
            }`}
          >
            {s === "ALL" ? "Все" : PAYMENT_LINK_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Список ссылок. */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <div className="text-sm text-neutral-500 dark:text-neutral-400 py-4">
          Ссылок в этом состоянии нет.
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((link) => (
            <div key={link.id} className="rounded-2xl border border-neutral-200 dark:border-white/10 p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={`px-2 py-0.5 rounded-lg text-[11px] font-medium ${STATUS_TONE[link.status]}`}>
                  {PAYMENT_LINK_STATUS_LABELS[link.status]}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {PAYMENT_LINK_PLAN_LABELS[link.plan] ?? link.plan} · {link.amount} {link.currency}
                </span>
                {link.label && (
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">{link.label}</span>
                )}
              </div>
              <div className="font-mono text-xs break-all text-neutral-700 dark:text-neutral-300 mb-2">{link.url}</div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                {link.status === "RESERVED" && (
                  <>
                    <div>Выдана: {personName(link.reservedBy)}</div>
                    <div>Бронь до: {moment(link.reservationExpiresAt)}</div>
                  </>
                )}
                {link.status === "AWAITING" && (
                  <>
                    <div>Плательщик: {personName(link.reservedBy)}</div>
                    <div>Отметил оплату: {moment(link.paidReportedAt)}</div>
                    {link.payerReference && <div>Ориентир платежа: {link.payerReference}</div>}
                  </>
                )}
                {link.status === "USED" && (
                  <>
                    <div>Подписка у: {personName(link.usedBy)}</div>
                    <div>Выдана: {moment(link.usedAt)}</div>
                    <div>Подтвердил: {personName(link.confirmedBy)}</div>
                    {link.subscriptionId && <div>Номер подписки: {link.subscriptionId}</div>}
                  </>
                )}
                {link.note && <div className="sm:col-span-2">Заметка: {link.note}</div>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {link.status === "AWAITING" && (
                  <Button onClick={() => act(link.id, "confirm")} disabled={busyId === link.id}>
                    Подтвердить оплату
                  </Button>
                )}
                {(link.status === "RESERVED" || link.status === "AWAITING") && (
                  <Button variant="secondary" onClick={() => act(link.id, "release")} disabled={busyId === link.id}>
                    Вернуть в пул
                  </Button>
                )}
                {link.status === "FREE" && (
                  <Button variant="secondary" onClick={() => act(link.id, "disable")} disabled={busyId === link.id}>
                    Отключить
                  </Button>
                )}
                {link.status === "DISABLED" && (
                  <Button variant="secondary" onClick={() => act(link.id, "enable")} disabled={busyId === link.id}>
                    Вернуть в работу
                  </Button>
                )}
                {link.status !== "USED" && (
                  <button
                    type="button"
                    onClick={() => remove(link.id)}
                    disabled={busyId === link.id}
                    className="px-3 py-1.5 rounded-xl text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition"
                  >
                    Удалить
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
