"use client";

/*
 * PAYLINK: оплата подписки по готовой ссылке банка (например b2b.cbrpay.ru/…).
 *
 * Банк не присылает сайту колбэк об успешном зачислении, поэтому цикл такой:
 *   1. пользователь берёт свободную ссылку из пула  -> RESERVED
 *   2. оплачивает в банке и нажимает «Я оплатил»     -> AWAITING
 *   3. администратор сверяет выписку и подтверждает  -> USED + подписка
 * Если в админке включён режим «включать сразу», шаг 3 выполняется автоматически.
 */

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";

type Kind = "PREMIUM" | "VPN";

type Offer = {
  id: string;
  kind: string;
  plan: string;
  planLabel: string;
  amount: number;
  currency: string;
  url: string;
  label: string | null;
  status: string;
  reservationExpiresAt: string | null;
  paidReportedAt: string | null;
};

type PlanOption = {
  plan: string;
  planLabel: string;
  amount: number;
  currency: string;
  count: number;
};

type LinksResponse = {
  kind: Kind;
  kindLabel: string;
  enabled: boolean;
  instruction: string;
  priceMonth: number | null;
  currency: string;
  reserveMinutes: number;
  plans: PlanOption[];
  offer: Offer | null;
};

function money(amount: number, currency: string) {
  if (!amount) return "—";
  return `${amount.toLocaleString("ru-RU")} ${currency || "RUB"}`;
}

function leftText(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} мин.`;
  return `${Math.floor(minutes / 60)} ч. ${minutes % 60} мин.`;
}

export default function PaymentLinkCheckout({ kind }: { kind: Kind }) {
  const [data, setData] = useState<LinksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [plan, setPlan] = useState("");
  const [reference, setReference] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/payments/links?kind=${kind}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError((json && json.error) || "Не удалось загрузить способы оплаты.");
        return;
      }
      setError("");
      setData(json as LinksResponse);
      setPlan((prev) => prev || (json?.plans?.[0]?.plan ?? "month"));
    } catch {
      setError("Сервер не ответил. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, fallback: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/payments/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError((json && json.error) || fallback);
        return null;
      }
      if (json?.message) setNotice(json.message);
      await load();
      return json;
    } catch {
      setError("Сервер не ответил. Попробуйте позже.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Раздел скрыт целиком, пока администратор не включил оплату по ссылке.
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Spinner /> Загружаем способы оплаты…
      </div>
    );
  }
  if (!data || !data.enabled) return null;

  const offer = data.offer;
  const awaiting = offer?.status === "AWAITING";
  const reserved = offer?.status === "RESERVED";
  const selected = data.plans.find((p) => p.plan === plan) ?? data.plans[0] ?? null;
  const left = leftText(offer?.reservationExpiresAt ?? null);

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 sm:p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
          Оплата по ссылке банка
        </h3>
        <p className="text-xs text-neutral-500 mt-1">
          {data.instruction ||
            "Мы выдадим вам персональную ссылку на оплату. После оплаты нажмите «Я оплатил» — подписка появится в профиле."}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {!offer && (
        <>
          {data.plans.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {data.plans.map((p) => (
                <button
                  key={p.plan}
                  type="button"
                  onClick={() => setPlan(p.plan)}
                  className={`rounded-xl border px-3 py-2 text-xs transition ${
                    p.plan === plan
                      ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      : "border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300"
                  }`}
                >
                  {p.planLabel} · {money(p.amount, p.currency)}
                </button>
              ))}
            </div>
          )}

          {data.plans.length === 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Свободных ссылок сейчас нет. Напишите администратору — он выпишет новую.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => post({ action: "reserve", plan }, "Не удалось получить ссылку.")} disabled={busy}>
                {busy ? "Готовим ссылку…" : "Получить ссылку на оплату"}
              </Button>
              {selected && (
                <span className="text-xs text-neutral-500">
                  {selected.planLabel} · {money(selected.amount, selected.currency)}
                </span>
              )}
            </div>
          )}
        </>
      )}

      {offer && (
        <div className="space-y-3">
          <div className="rounded-xl bg-neutral-100 dark:bg-neutral-900 px-3 py-2">
            <div className="text-xs text-neutral-500">
              {offer.planLabel} · {money(offer.amount, offer.currency)}
              {left && reserved ? ` · ссылка закреплена за вами ещё ${left}` : ""}
            </div>
            <div className="mt-1 break-all font-mono text-xs text-neutral-800 dark:text-neutral-200">
              {offer.url}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href={offer.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-medium text-white transition"
            >
              Перейти к оплате
            </a>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(offer.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setError("Браузер не дал скопировать ссылку — выделите её вручную.");
                }
              }}
              className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-4 py-2 text-xs text-neutral-700 dark:text-neutral-200"
            >
              {copied ? "Скопировано" : "Скопировать"}
            </button>
          </div>

          {awaiting ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Мы получили отметку об оплате
              {offer.paidReportedAt
                ? ` (${new Date(offer.paidReportedAt).toLocaleString("ru-RU")})`
                : ""}
              . Администратор сверит зачисление и включит подписку — обычно это занимает несколько часов.
            </p>
          ) : (
            <div className="space-y-2">
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value.slice(0, 200))}
                placeholder="Номер платежа или ФИО плательщика (необязательно)"
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-xs text-neutral-900 dark:text-white"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() =>
                    post(
                      { action: "paid", linkId: offer.id, reference: reference.trim() || undefined },
                      "Не удалось отправить отметку об оплате.",
                    )
                  }
                  disabled={busy}
                >
                  {busy ? "Отправляем…" : "Я оплатил"}
                </Button>
                <span className="text-xs text-neutral-500">
                  Нажимайте только после успешной оплаты в банке.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
