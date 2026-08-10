"use client";

import AppealComposer from "./AppealComposer";

/**
 * НОВОЕ: полное «скелетирование» всего приложения при глобальном бане
 * (остановке учётной записи). Забаненный пользователь видит вместо всех
 * проектов неинтерактивные скелетон-заглушки и надпись о приостановке.
 * Оверлей перекрывает весь интерфейс (z-[100]) и блокирует любые клики,
 * поэтому ничего не перекрывается другими элементами и листать нечего.
 */
export default function AccountSuspendedOverlay({
  until,
  reason,
}: {
  until?: string | null;
  reason?: string | null;
}) {
  const rows = [58, 42, 74, 36, 66, 50, 70, 44];
  return (
    <div
      className="fixed inset-0 z-[100] flex bg-white dark:bg-neutral-950 select-none"
      aria-label="Действие учётной записи приостановлено"
    >
      {/* Скелетон всего приложения: колонки проектов, каналов и сообщений */}
      <div className="pointer-events-none flex h-full w-full overflow-hidden" aria-hidden="true">
        <div className="hidden sm:flex w-16 flex-col items-center gap-3 border-r border-neutral-200 dark:border-white/10 py-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-10 w-10 rounded-2xl bg-neutral-200 dark:bg-white/10 animate-pulse" />
          ))}
        </div>
        <div className="hidden md:block w-60 border-r border-neutral-200 dark:border-white/10 p-4 space-y-3">
          <div className="h-6 w-3/4 rounded bg-neutral-200 dark:bg-white/10 animate-pulse" />
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="h-4 rounded bg-neutral-200 dark:bg-white/10 animate-pulse"
              style={{ width: `${55 + ((i * 17) % 40)}%` }}
            />
          ))}
        </div>
        <div className="flex-1 p-6 space-y-6 overflow-hidden">
          {rows.map((w, i) => (
            <div key={i} className={`flex gap-3 ${i % 3 === 2 ? "flex-row-reverse" : ""}`}>
              <div className="w-9 h-9 rounded-full bg-neutral-200 dark:bg-white/10 animate-pulse flex-shrink-0" />
              <div className="space-y-2 min-w-0" style={{ width: `${w}%`, maxWidth: "28rem" }}>
                <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-white/10 animate-pulse" />
                <div className="h-10 w-full rounded-2xl bg-neutral-200 dark:bg-white/10 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Затемнение + надпись о приостановке */}
      <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-neutral-950/60 backdrop-blur-[2px] p-4">
        <div className="w-full max-w-md rounded-2xl border border-red-200 dark:border-red-500/30 bg-white dark:bg-neutral-900 p-6 text-center shadow-xl">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-500">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M4.93 4.93l14.14 14.14" />
            </svg>
          </div>
          <h3 className="mb-1 text-base font-semibold text-neutral-900 dark:text-white">
            Действие учётной записи приостановлено
          </h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {until ? `Ограничение действует до ${new Date(until).toLocaleString("ru-RU")}.` : "Ограничение действует бессрочно."}
            {reason ? ` Причина: ${reason}.` : ""}
          </p>
          <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
            Просмотр и отправка сообщений во всех проектах недоступны.
            Если вы считаете это ошибкой, отправьте обжалование администрации.
          </p>
          <AppealComposer mode="ban" />
        </div>
      </div>
    </div>
  );
}
