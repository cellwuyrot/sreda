"use client";

import { ClockIcon } from "@/components/ui/ConnectIcons";

/**
 * PROFILE-WALL: листатель по 15 записей.
 *
 * Отдельный компонент, потому что он стоит под тремя разными списками (записи,
 * подписчики, подписки) и во всех трёх должен вести себя одинаково.
 *
 * Номер страницы показан текстом, а не рядом цифр: при сотне страниц ряд цифр
 * превращается в кашу, а прыгать на страницу «57» на стене никому не нужно.
 */
export default function WallPager({
  page,
  pages,
  total,
  unit,
  onChange,
  busy,
}: {
  page: number;
  pages: number;
  total: number;
  unit: string;
  onChange: (page: number) => void;
  busy?: boolean;
}) {
  if (pages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <button
        type="button"
        disabled={busy || page <= 1}
        onClick={() => onChange(page - 1)}
        className="px-3 py-1.5 rounded-lg text-sm border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-gray-300 hover:bg-neutral-50 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        ← Назад
      </button>

      <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-gray-400">
        <ClockIcon size={14} style={{ color: "inherit" }} />
        <span>
          Стр. {page} из {pages} · {total} {unit}
        </span>
      </div>

      <button
        type="button"
        disabled={busy || page >= pages}
        onClick={() => onChange(page + 1)}
        className="px-3 py-1.5 rounded-lg text-sm border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-gray-300 hover:bg-neutral-50 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Вперёд →
      </button>
    </div>
  );
}
