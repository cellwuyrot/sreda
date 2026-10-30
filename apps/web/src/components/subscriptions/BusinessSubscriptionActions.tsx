"use client";
import { isAndroidShell } from "@/lib/shell";
import { useCallback, useEffect, useState } from "react";
import { businessPriceLabel, parseBusinessOffers, type BusinessOffer, type BusinessSubscriptionKind } from "@/lib/businessSubscriptions";
export default function BusinessSubscriptionActions({ kind, active = false, compact = false }: { kind: BusinessSubscriptionKind; active?: boolean; compact?: boolean }) {
  const [android, setAndroid] = useState(false);
  const [provisional, setProvisional] = useState<string | null>(null);
  const [offer, setOffer] = useState<BusinessOffer | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    if (isAndroidShell()) { setAndroid(true); setLoading(false); return; }
    const controller = new AbortController(); let alive = true;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setLoading(true); setError(false);
    fetch("/api/subscriptions/business", { cache: "no-store", signal: controller.signal })
      .then(async r => { if (!r.ok) throw Error("Каталог недоступен"); return await r.json() as { offers?: unknown; provisional?: Record<string, unknown> }; })
      .then(raw => { const data = parseBusinessOffers(raw); const until = raw.provisional?.[kind]; if (alive) { setOffer(data[kind]); setProvisional(typeof until === "string" && Number.isFinite(Date.parse(until)) && Date.parse(until) > Date.now() ? until : null); } })
      .catch(() => { if (alive) { setOffer(null); setError(true); } })
      .finally(() => { window.clearTimeout(timeout); if (alive) setLoading(false); });
    return () => { alive = false; window.clearTimeout(timeout); controller.abort(); };
  }, [kind, attempt]);
  if (android) return <p className="text-sm opacity-75">{active ? "Доступ действует для вашего аккаунта." : "В этой Android-версии доступны ранее подключённые подписки аккаунта. Покупки внутри приложения не поддерживаются."}</p>;
  if (loading) return <p role="status" className="text-sm opacity-75">Проверяем предложения Business…</p>;
  if (error) return <div className="space-y-2 text-sm"><p role="status">Не удалось загрузить условия подписки. Это не меняет ваш действующий доступ.</p><button type="button" onClick={retry} className="min-h-11 rounded-lg border border-current px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Повторить загрузку</button></div>;
  const trustNote = provisional ? <p role="status" className="text-sm">Доверительное подключение до {new Date(provisional).toLocaleString("ru-RU")}. По этой заявке оплата ещё не подтверждена.</p> : null;
  if (!offer) return <div>{trustNote}<p className="text-sm opacity-75">{active ? "Действующий доступ сохраняется. " : ""}Предложение {kind === "VPN" ? "надёжного соединения" : "Premium"} пока не опубликовано в Business.</p></div>;
  return <div className="space-y-2" data-business-subscription={kind}>
    {trustNote}
    {!active && <p className="text-sm font-medium">{businessPriceLabel(offer)}</p>}
    <a href={offer.href} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${compact ? "bg-[#87dfd8] text-[#132625] hover:bg-[#a2ece6]" : "bg-violet-600 text-white hover:bg-violet-700 dark:bg-cyan-300 dark:text-neutral-950 dark:hover:bg-cyan-200"}`}>
      {active ? "Управлять подпиской в Business" : "Оформить в Business"}<span aria-hidden="true">↗</span>
    </a>
    <p className="text-sm opacity-75">{active ? "Оплата и продление — в Business." : "Выберите период и способ оплаты в Business."} Вход — тем же аккаунтом TZ ID. Откроется новая вкладка.</p>
  </div>;
}
