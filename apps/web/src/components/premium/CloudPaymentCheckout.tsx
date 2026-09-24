"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";

type Kind = "PREMIUM" | "VPN";

type PublicConfig = {
  kind: Kind;
  enabled: boolean;
  price: number | null;
  currency: string;
  plan: "month";
  recurring: boolean;
};

type OrderResponse = {
  order?: {
    invoiceId: string;
    paymentUrl: string | null;
    amount: number;
    currency: string;
    status: string;
  };
  redirectUrl?: string | null;
  error?: string;
};

function money(amount: number | null, currency: string) {
  if (!amount) return "—";
  return `${amount.toLocaleString("ru-RU")} ${currency || "RUB"}`;
}

export default function CloudPaymentCheckout({ kind }: { kind: Kind }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const startedRef = useRef(false);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/payments/cloudpayments?kind=${kind}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as PublicConfig & { error?: string };
      if (!res.ok) {
        setError(json?.error || "Не удалось загрузить CloudPayments.");
        return;
      }
      setConfig(json);
    } catch {
      setError("Сервер не ответил. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  const checkReturnPayment = useCallback(async (invoiceId: string) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setChecking(true);
    setError("");
    setMessage("Проверяем оплату…");

    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const res = await fetch("/api/payments/cloudpayments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", kind, invoiceId }),
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);

        if (res.ok && json?.status === "PAID") {
          setMessage("Оплата подтверждена. Подписка активирована.");
          setChecking(false);
          window.history.replaceState({}, "", "/settings");
          window.setTimeout(() => window.location.reload(), 800);
          return;
        }

        if (res.ok && json?.status === "FAILED") {
          setError(json?.order?.failureReason || "CloudPayments отклонил платёж.");
          setChecking(false);
          window.history.replaceState({}, "", "/settings");
          return;
        }

        setMessage("Платёж ещё обрабатывается. Обновляем статус…");
      } catch {
        setMessage("Не удалось проверить статус. Повторяем попытку…");
      }

      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }

    setChecking(false);
    setMessage("Платёж пока не подтверждён. Можно обновить статус позже.");
  }, [kind]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "cloudpayments") return;
    if (params.get("kind") !== kind) return;
    const invoiceId = params.get("order");
    if (!invoiceId) return;
    void checkReturnPayment(invoiceId);
  }, [checkReturnPayment, kind]);

  async function createPayment() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/payments/cloudpayments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", kind }),
      });
      const json = (await res.json().catch(() => null)) as OrderResponse | null;
      if (!res.ok) {
        setError(json?.error || "Не удалось создать ссылку на оплату.");
        return;
      }
      const url = json?.redirectUrl || json?.order?.paymentUrl;
      if (!url) {
        setError("CloudPayments не вернул ссылку на оплату.");
        return;
      }
      window.location.href = url;
    } catch {
      setError("Сервер не ответил. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Spinner /> Загружаем интернет-эквайринг…
      </div>
    );
  }

  if (!config?.enabled && !checking && !message) return null;

  return (
    <div className="mt-3 rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
          Оплата картой через CloudPayments
        </h3>
        <p className="text-xs text-neutral-500 mt-1">
          {config?.price
            ? `${money(config.price, config.currency)} в месяц. После первой оплаты CloudPayments использует рекуррентное списание раз в месяц, а сервер подтверждает каждый успешный платёж перед активацией/продлением подписки.`
            : "Интернет-эквайринг CloudPayments настроен администратором."}
        </p>
      </div>

      {message && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          {message}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {config?.enabled && !checking && (
        <Button onClick={() => void createPayment()} disabled={busy}>
          {busy ? "Готовим оплату…" : `Оплатить ${money(config.price, config.currency)}`}
        </Button>
      )}
    </div>
  );
}
