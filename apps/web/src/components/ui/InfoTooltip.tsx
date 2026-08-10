"use client";

import { useId } from "react";
import { QuestionIcon } from "@/components/ui/ConnectIcons";

/**
 * Компактная подсказка «?»: маленькая иконка вопроса, которая при наведении
 * (или фокусе с клавиатуры) показывает всплывающее пояснение. Используется в
 * настройках, чтобы вынести описательный текст из интерфейса и оставить только
 * сами элементы управления — информация доступна по требованию.
 */
export default function InfoTooltip({
  text,
  side = "top",
  className = "",
}: {
  text: string;
  /** С какой стороны от иконки раскрывать подсказку. */
  side?: "top" | "bottom";
  className?: string;
}) {
  const id = useId();
  const pos =
    side === "bottom"
      ? "top-full mt-2 after:bottom-full after:border-b-neutral-900 dark:after:border-b-neutral-800"
      : "bottom-full mb-2 after:top-full after:border-t-neutral-900 dark:after:border-t-neutral-800";
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-describedby={id}
        aria-label="Подробнее"
        onClick={(e) => e.preventDefault()}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 transition-colors cursor-help"
      >
        <QuestionIcon size={14} />
      </button>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 w-56 -translate-x-1/2 rounded-lg bg-neutral-900 dark:bg-neutral-800 px-3 py-2 text-xs font-normal leading-snug text-white shadow-lg ring-1 ring-white/10 opacity-0 invisible transition-all duration-150 group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible after:absolute after:left-1/2 after:-translate-x-1/2 after:border-4 after:border-transparent ${pos}`}
      >
        {text}
      </span>
    </span>
  );
}
