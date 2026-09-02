"use client";

import { useCallback, useEffect, useState } from "react";

interface AppealComposerProps {
  mode?: "floating" | "ban";
}

interface BanAppealStatus {
  allowed: boolean;
  used: number;
  remaining: number;
  limit: number;
}

/**
 * Global user → administration appeal entry point.
 * - floating: envelope button in the lower-right corner of TZ Connect.
 * - ban: compact button inside the account-suspension overlay, limited by API
 *   to two submissions for the current ban cycle.
 */
export default function AppealComposer({ mode = "floating" }: AppealComposerProps) {
  const isBan = mode === "ban";
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(isBan ? "Обжалование блокировки" : "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [banStatus, setBanStatus] = useState<BanAppealStatus | null>(null);

  const loadBanStatus = useCallback(async () => {
    if (!isBan) return;
    try {
      const res = await fetch("/api/appeals?banStatus=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.banAppeal) setBanStatus(data.banAppeal);
    } catch {
      // The connection overlay handles network loss globally.
    }
  }, [isBan]);

  useEffect(() => { void loadBanStatus(); }, [loadBanStatus]);

  const submit = async () => {
    if (!subject.trim() || !body.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          category: isBan ? "BAN_APPEAL" : "GENERAL",
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Не удалось отправить обращение");
        if (data?.banAppeal) setBanStatus(data.banAppeal);
        return;
      }
      if (data?.banAppeal) setBanStatus(data.banAppeal);
      setSent(true);
      setBody("");
      if (!isBan) setSubject("");
      window.setTimeout(() => {
        setOpen(false);
        setSent(false);
      }, 1400);
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setSending(false);
    }
  };

  const remaining = banStatus?.remaining ?? 2;
  const disabled = isBan && remaining <= 0;

  return (
    <>
      {isBan ? (
        <div className="mt-4">
          <button
            type="button"
            disabled={disabled}
            onClick={() => { setError(""); setOpen(true); }}
            className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-45"
          >
            ✉ Обжаловать блокировку
          </button>
          <p className="mt-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
            Осталось обращений для этого бана: {remaining} из {banStatus?.limit ?? 2}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setError(""); setOpen(true); }}
          className="fixed bottom-[calc(1rem+var(--tz-desktop-inset-bottom,0px))] right-4 z-[55] grid h-12 w-12 place-items-center rounded-full border border-violet-400/30 bg-violet-600 text-white shadow-[0_12px_35px_rgba(79,70,229,.35)] transition hover:scale-105 hover:bg-violet-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-violet-400/30 dark:border-cyan-300/30 dark:bg-cyan-500 dark:text-neutral-950 dark:shadow-[0_12px_35px_rgba(34,211,238,.25)]"
          aria-label="Написать обращение администрации"
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m4 7 8 6 8-6" />
          </svg>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 text-left shadow-2xl dark:border-white/10 dark:bg-neutral-900" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
                  {isBan ? "Обжалование блокировки" : "Обращение администрации"}
                </h3>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  {isBan
                    ? `Можно отправить не более двух обжалований за один бан. Осталось: ${remaining}.`
                    : "Сообщение поступит администраторам TZ Connect."}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Закрыть">✕</button>
            </div>

            {sent ? (
              <div className="rounded-xl bg-emerald-500/10 px-4 py-5 text-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Обращение отправлено администрации
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={120}
                  placeholder="Тема обращения"
                  className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900 outline-none focus:border-violet-400 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:focus:border-cyan-400"
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={4000}
                  rows={6}
                  placeholder={isBan ? "Объясните, почему блокировку следует пересмотреть…" : "Опишите вопрос или проблему…"}
                  className="w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900 outline-none focus:border-violet-400 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:focus:border-cyan-400"
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-4 py-2 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/[0.06]">Отмена</button>
                  <button
                    type="button"
                    disabled={sending || disabled || !subject.trim() || !body.trim()}
                    onClick={submit}
                    className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
                  >
                    {sending ? "Отправка…" : "Отправить"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
