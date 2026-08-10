"use client";

/**
 * NEW: «Скелетирование» группы. Когда администрация ставит группу на паузу,
 * все участники, кроме владельца и администраторов, вместо содержимого
 * канала видят этот экран: неинтерактивные скелетон-заглушки сообщений
 * (листать и писать нельзя) и краткое пояснение. Сервер при этом не отдаёт
 * историю сообщений и не принимает новые (см. /api/messages).
 */
export default function GroupPausedSkeleton() {
  const rows = [62, 40, 78, 34, 55, 70, 45, 58, 66, 38];
  return (
    <div className="relative flex-1 h-full overflow-hidden select-none" aria-label="Группа приостановлена">
      {/* Декоративный скелетон сообщений: не прокручивается и не кликается */}
      <div className="absolute inset-0 p-6 space-y-6 pointer-events-none overflow-hidden" aria-hidden="true">
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
      {/* Затемнение + пояснение */}
      <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-neutral-950/60 backdrop-blur-[2px]">
        <div className="mx-4 max-w-sm rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-6 text-center shadow-xl">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </div>
          <h3 className="mb-1 text-base font-semibold text-neutral-900 dark:text-white">Группа приостановлена</h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Администрация временно поставила группу на паузу. Сообщения скрыты,
            отправка и просмотр истории недоступны, пока пауза не будет снята.
          </p>
        </div>
      </div>
    </div>
  );
}
