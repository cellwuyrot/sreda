"use client";

import { BOARD_TEMPLATES, SPHERE_LABEL, SPHERE_ORDER, type BoardTemplate } from "@/lib/boardTemplates";

/**
 * TPL: панель заготовок доски.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Пустой холст — худший экран в любом инструменте. «Пусто. Добавьте первый
 * узел» отвечает на вопрос «что можно», но не на вопрос «с чего начать».
 * Заготовка отвечает на второй: разворачивает готовую доску, которую остаётся
 * поправить под себя.
 *
 * Сферы намеренно разные — работа, увлечения, личные цели. Одними рабочими
 * примерами доска читается как ещё один трекер для офиса, хотя это не так.
 *
 * ── Почему только на пустую доску ───────────────────────────────────────────
 *
 * Заготовка кладёт полтора десятка карточек. Поверх начатой работы это месиво,
 * и разобрать его нечем. Поэтому на непустой доске панель не прячется — она
 * честно объясняет, что делать: холстов в разделе несколько, завести новый под
 * заготовку — одно нажатие.
 */
export default function TemplatesPanel({
  canApply,
  onApply,
  onClose,
}: {
  /** Пуста ли текущая доска. */
  canApply: boolean;
  onApply: (template: BoardTemplate) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-16" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div>
            <div className="text-sm font-semibold text-neutral-900 dark:text-white">Заготовки досок</div>
            <div className="text-[12px] text-neutral-400">
              {canApply
                ? "Развернётся на этом холсте — потом правьте как обычные карточки"
                : "Холст не пуст. Переключитесь на пустой холст или создайте новый"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-lg px-2 py-1 text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {SPHERE_ORDER.map((sphere) => {
            const items = BOARD_TEMPLATES.filter((t) => t.sphere === sphere);
            if (items.length === 0) return null;
            return (
              <div key={sphere} className="mb-5 last:mb-0">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                  {SPHERE_LABEL[sphere]}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      disabled={!canApply}
                      onClick={() => onApply(template)}
                      className="rounded-xl border border-neutral-200 px-3 py-2.5 text-left transition-colors hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:border-neutral-500"
                    >
                      <div className="text-[13px] font-medium text-neutral-900 dark:text-white">{template.name}</div>
                      <div className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">{template.summary}</div>
                      <div className="mt-1 text-[11px] text-neutral-400">{template.cards.length} карточек</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
