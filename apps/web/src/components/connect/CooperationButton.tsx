"use client";

import { useEffect, useState } from "react";
import InfoTooltip from "@/components/ui/InfoTooltip";

// FIX-COOP: кнопка «Сотрудничество» в нижней части панели каналов главной
// группы TZ Connect — над кнопкой «Пригласить», в стиле остальных кнопок
// панели (не оверлей). Пользователь подтверждает,
// что ознакомился с условиями предоставляемых услуг, выбирает услугу —
// заявка уходит в раздел обращений админ-панели (категория COOPERATION),
// после изучения админ может назначить пользователю роль CONSULTANT
// (/admin/users) — и у него появится Личный кабинет.

interface ServiceItem { id: string; title: string; description: string; icon?: string | null }

export default function CooperationButton() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || loaded) return;
    fetch("/api/services")
      .then((r) => r.json())
      .then((d) => setServices(Array.isArray(d) ? d : []))
      .catch(() => setServices([]))
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  const selected = services.find((s) => s.id === serviceId) || null;

  const submit = async () => {
    if (!selected || !agreed || sending) return;
    setSending(true);
    setError("");
    try {
      const body = [
        `Пользователь ознакомился с условиями предоставляемых услуг и хотел бы заказать: «${selected.title}».`,
        comment.trim() ? `Комментарий: ${comment.trim()}` : "",
      ].filter(Boolean).join("\n\n");
      const res = await fetch("/api/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: `Сотрудничество: ${selected.title}`.slice(0, 120), body, category: "COOPERATION" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось отправить заявку"); return; }
      setSent(true);
      window.setTimeout(() => {
        setOpen(false);
        setSent(false);
        setAgreed(false);
        setComment("");
        setServiceId("");
      }, 1600);
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(""); setOpen(true); }}
        className="w-full px-3 py-1.5 text-left text-sm text-accent hover:bg-violet-50 dark:hover:bg-cyan-400/10 rounded-lg transition-colors flex items-center gap-2"
        aria-label="Сотрудничество — заказать услугу TrioZ"
        title="Сотрудничество"
      >
        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 17a5 5 0 0 1-5 5H4v-2a5 5 0 0 1 5-5" transform="translate(0 -8) scale(.9)" opacity="0" />
          <path d="m11 12 2.2 2.1a2 2 0 0 0 2.8 0l5-4.9L16.5 5h-4L8 9.2a2 2 0 0 0 2.9 2.9L13 10" />
          <path d="m3 9.3 5.5-4.6L11 6" />
          <path d="m14.5 16.5-2 2a2 2 0 0 1-2.9-2.9" />
        </svg>
        Сотрудничество
      </button>

      {open && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 text-left shadow-2xl dark:border-white/10 dark:bg-neutral-900" onMouseDown={(e) => e.stopPropagation()}>
            {sent ? (
              <div className="py-8 text-center">
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-violet-500/10 text-2xl text-violet-600 dark:bg-cyan-500/10 dark:text-cyan-400">✓</div>
                <p className="text-sm font-medium text-neutral-900 dark:text-white">Заявка отправлена</p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">Администрация изучит её и свяжется с вами.</p>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
                      Сотрудничество
                      <InfoTooltip text="Отметьте нужную услугу и отправьте заявку — она уйдёт напрямую администрации TrioZ." side="bottom" className="ml-1" />
                    </h3>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Закрыть">✕</button>
                </div>

                <div className="space-y-3">
                  <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                    {!loaded ? (
                      <p className="py-4 text-center text-xs text-neutral-400">Загрузка услуг…</p>
                    ) : services.length === 0 ? (
                      <p className="py-4 text-center text-xs text-neutral-400">Список услуг пока пуст — загляните позже.</p>
                    ) : (
                      services.map((s) => (
                        <label key={s.id} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition ${serviceId === s.id ? "border-violet-400 bg-violet-500/10 dark:border-cyan-400/60 dark:bg-cyan-500/10" : "border-neutral-200 hover:border-neutral-300 dark:border-white/10 dark:hover:border-white/20"}`}>
                          <input type="radio" name="coop-service" className="mt-1 accent-violet-600 dark:accent-cyan-500" checked={serviceId === s.id} onChange={() => setServiceId(s.id)} />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-neutral-900 dark:text-white">{s.title}</span>
                            <span className="mt-0.5 block text-xs text-neutral-500 dark:text-gray-400">{s.description}</span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>

                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={1000}
                    rows={2}
                    placeholder="Комментарий к заказу (необязательно)"
                    className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-violet-400 dark:border-white/10 dark:bg-neutral-950 dark:text-white dark:focus:border-cyan-400/60"
                  />

                  <label className="flex cursor-pointer items-start gap-2.5 text-xs text-neutral-600 dark:text-gray-300">
                    <input type="checkbox" className="mt-0.5 accent-violet-600 dark:accent-cyan-500" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                    Я ознакомился(-ась) с условиями предоставляемых услуг и хочу заказать выбранную
                  </label>

                  {error && <p className="text-xs text-red-500">{error}</p>}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5">Отмена</button>
                    <button type="button" onClick={() => void submit()} disabled={!selected || !agreed || sending} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400">
                      {sending ? "Отправка…" : "Отправить заявку"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
