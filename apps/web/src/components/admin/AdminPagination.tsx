"use client";

interface Props { page: number; pages: number; total: number; loading?: boolean; onPageChange: (page: number) => void }
export default function AdminPagination({ page, pages, total, loading = false, onPageChange }: Props) {
  return <nav aria-label="Страницы списка" className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 p-4 dark:border-white/10">
    <p role="status" className="text-sm text-neutral-600 dark:text-gray-400">Страница {page} из {pages} · Всего: {total}</p>
    <div className="flex gap-2">
      <button type="button" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} className="rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5">Назад</button>
      <button type="button" disabled={loading || page >= pages} onClick={() => onPageChange(page + 1)} className="rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5">Далее</button>
    </div>
  </nav>;
}
