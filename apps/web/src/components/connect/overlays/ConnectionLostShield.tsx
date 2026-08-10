"use client";

/* REFACTOR-A: вынесено из app/connect/page.tsx без изменений разметки.
   A full-screen interaction shield with a deliberately small status
   card. It prevents users from typing/sending into a dead connection
   without realising that their actions cannot reach the server. */
export default function ConnectionLostShield({ reconnectAttempt }: { reconnectAttempt: number }) {
  return (
    <div
      className="fixed inset-0 z-[200] grid cursor-wait place-items-center bg-black/35 p-4 backdrop-blur-[2px]"
      role="alert"
      aria-live="assertive"
      aria-label="Соединение потеряно, выполняется переподключение"
    >
      <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-neutral-950/95 px-5 py-4 text-center text-white shadow-2xl">
        <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
        <p className="text-sm font-semibold">Соединение потеряно</p>
        <p className="mt-1 text-xs text-white/55">Пытаемся подключиться снова…</p>
        {reconnectAttempt > 1 && (
          <p className="mt-2 text-[10px] text-white/35">Попытка {reconnectAttempt}</p>
        )}
      </div>
    </div>
  );
}
