"use client";

import { useSession } from "next-auth/react";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

/**
 * PREMIUM-PAY: платёжные реквизиты для покупки Premium.
 * Заполняет администратор; на эти данные поступает оплата от клиента.
 * Поддерживаются СБП-перевод и интернет-эквайринг.
 */

interface PaymentSettings {
  premium_price_month: string;
  premium_currency: string;
  pay_sbp_enabled: string;
  pay_sbp_phone: string;
  pay_sbp_bank: string;
  pay_sbp_recipient: string;
  pay_sbp_comment: string;
  pay_acquiring_enabled: string;
  pay_acquiring_provider: string;
  pay_acquiring_link: string;
  pay_acquiring_merchant: string;
  pay_acquiring_secret: string;
  pay_acquiring_comment: string;
  pay_acquiring_secret_set?: string;
}

const EMPTY: PaymentSettings = {
  premium_price_month: "",
  premium_currency: "RUB",
  pay_sbp_enabled: "0",
  pay_sbp_phone: "",
  pay_sbp_bank: "",
  pay_sbp_recipient: "",
  pay_sbp_comment: "",
  pay_acquiring_enabled: "0",
  pay_acquiring_provider: "",
  pay_acquiring_link: "",
  pay_acquiring_merchant: "",
  pay_acquiring_secret: "",
  pay_acquiring_comment: "",
};

const inputClass =
  "w-full px-4 py-3 rounded-xl text-sm bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30";
const labelClass = "block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2";

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3"
      aria-pressed={on}
    >
      <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-violet-500" : "bg-neutral-300 dark:bg-white/15"}`}>
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
      </span>
      <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{label}</span>
    </button>
  );
}

export default function AdminPaymentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [settings, setSettings] = useState<PaymentSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [secretSet, setSecretSet] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/admin");
  }, [session, status, router]);

  useEffect(() => {
    if (session?.user?.role === "ADMIN") {
      fetch("/api/admin/payments")
        .then((r) => (r.ok ? r.json() : {}))
        .then((data: Record<string, string>) => {
          setSecretSet(data.pay_acquiring_secret_set === "1");
          // Замаскированный секрет не подставляем в поле — оставляем пустым.
          setSettings((prev) => ({ ...prev, ...data, pay_acquiring_secret: "" }));
        })
        .finally(() => setLoading(false));
    }
  }, [session]);

  const update = (patch: Partial<PaymentSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    const res = await fetch("/api/admin/payments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, ...extra }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (settings.pay_acquiring_secret) setSecretSet(true);
      if (extra.pay_acquiring_secret_clear) setSecretSet(false);
      setSettings((s) => ({ ...s, pay_acquiring_secret: "" }));
    }
  };

  if (status === "loading" || loading) {
    return <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-dark-900"><Spinner /></div>;
  }
  if (session?.user?.role !== "ADMIN") return null;

  const sbpOn = settings.pay_sbp_enabled === "1";
  const acqOn = settings.pay_acquiring_enabled === "1";

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link href="/admin" className="text-violet-500 hover:text-violet-400 text-sm mb-2 inline-flex items-center gap-1 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Админ-панель
          </Link>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Платёжные реквизиты Premium</h1>
          <p className="text-neutral-500 text-sm mt-1">Данные, на которые поступает оплата подписки от клиента. Настраиваются администратором.</p>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Цена */}
          <div className="bg-white dark:bg-neutral-800/50 rounded-2xl border border-neutral-200 dark:border-white/10 p-6">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-white mb-4">Стоимость</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Цена за месяц</label>
                <input inputMode="numeric" value={settings.premium_price_month} onChange={(e) => update({ premium_price_month: e.target.value.replace(/[^\d]/g, "") })} placeholder="299" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Валюта</label>
                <input value={settings.premium_currency} onChange={(e) => update({ premium_currency: e.target.value.slice(0, 8) })} placeholder="RUB" className={inputClass} />
              </div>
            </div>
          </div>

          {/* СБП */}
          <div className="bg-white dark:bg-neutral-800/50 rounded-2xl border border-neutral-200 dark:border-white/10 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-white">СБП-перевод</h2>
              <Toggle on={sbpOn} onClick={() => update({ pay_sbp_enabled: sbpOn ? "0" : "1" })} label={sbpOn ? "Включён" : "Выключен"} />
            </div>
            <div className={sbpOn ? "space-y-4" : "space-y-4 opacity-50 pointer-events-none"}>
              <div>
                <label className={labelClass}>Номер телефона получателя</label>
                <input value={settings.pay_sbp_phone} onChange={(e) => update({ pay_sbp_phone: e.target.value })} placeholder="+7 900 000-00-00" className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Банк получателя</label>
                  <input value={settings.pay_sbp_bank} onChange={(e) => update({ pay_sbp_bank: e.target.value })} placeholder="Например, Т-Банк" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Имя получателя</label>
                  <input value={settings.pay_sbp_recipient} onChange={(e) => update({ pay_sbp_recipient: e.target.value })} placeholder="Иван И." className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Комментарий / инструкция</label>
                <textarea value={settings.pay_sbp_comment} onChange={(e) => update({ pay_sbp_comment: e.target.value })} rows={2} placeholder="В комментарии к переводу укажите ваш username." className={inputClass + " resize-none"} />
              </div>
            </div>
          </div>

          {/* Эквайринг */}
          <div className="bg-white dark:bg-neutral-800/50 rounded-2xl border border-neutral-200 dark:border-white/10 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-white">Интернет-эквайринг</h2>
              <Toggle on={acqOn} onClick={() => update({ pay_acquiring_enabled: acqOn ? "0" : "1" })} label={acqOn ? "Включён" : "Выключен"} />
            </div>
            <div className={acqOn ? "space-y-4" : "space-y-4 opacity-50 pointer-events-none"}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Провайдер</label>
                  <input value={settings.pay_acquiring_provider} onChange={(e) => update({ pay_acquiring_provider: e.target.value })} placeholder="ЮKassa, Тинькофф…" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Идентификатор магазина</label>
                  <input value={settings.pay_acquiring_merchant} onChange={(e) => update({ pay_acquiring_merchant: e.target.value })} placeholder="shopId / terminalKey" className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Платёжная ссылка</label>
                <input value={settings.pay_acquiring_link} onChange={(e) => update({ pay_acquiring_link: e.target.value })} placeholder="https://…" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>
                  Секретный ключ {secretSet && <span className="text-emerald-500 text-xs font-normal">· сохранён</span>}{" "}
                  <InfoTooltip text="Ключ хранится в зашифрованном виде, целиком его больше нигде не увидеть — ни здесь, ни в базе." />
                </label>
                <input type="password" value={settings.pay_acquiring_secret} onChange={(e) => update({ pay_acquiring_secret: e.target.value })} placeholder={secretSet ? "•••••• (оставьте пустым, чтобы не менять)" : "Секретный ключ провайдера"} className={inputClass} />
                {secretSet && (
                  <button type="button" onClick={() => save({ pay_acquiring_secret_clear: true })} className="mt-2 text-xs text-red-500 hover:text-red-400">
                    Удалить сохранённый ключ
                  </button>
                )}
              </div>
              <div>
                <label className={labelClass}>Комментарий / инструкция</label>
                <textarea value={settings.pay_acquiring_comment} onChange={(e) => update({ pay_acquiring_comment: e.target.value })} rows={2} placeholder="Например: после оплаты пришлите чек администратору." className={inputClass + " resize-none"} />
              </div>
            </div>
          </div>

          <Button onClick={() => save()} disabled={saving} size="lg" fullWidth>
            {saving ? "Сохранение..." : saved ? "Сохранено ✓" : "Сохранить реквизиты"}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
