"use client";

/* REFACTOR-A: подтверждающая модалка страницы Connect — вынесена из
   app/connect/page.tsx без изменений разметки. */
export default function PageConfirmModal({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl shadow-2xl p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <p className="text-sm text-neutral-900 dark:text-white mb-4">{message}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5">Отмена</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors">Подтвердить</button>
        </div>
      </div>
    </div>
  );
}
