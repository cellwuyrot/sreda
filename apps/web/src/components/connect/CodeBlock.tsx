"use client";

/**
 * Блок кода в сообщении: текст в тройных кавычках.
 *
 * До этого поделиться кодом было нечем. Разметка знала только `короткий код`
 * внутри строки, поэтому программа уезжала в чат обычным текстом: перенос строк
 * оставался, а отступы съедались вёрсткой, длинные строки переносились по
 * словам, и понять, где кончается код и начинается фраза, было нельзя.
 *
 * Здесь нет подсветки синтаксиса — она потребовала бы отдельной библиотеки на
 * каждый язык. Задача другая: показать, что это код, и дать его забрать. Поэтому
 * моноширинный шрифт, сохранённые отступы, горизонтальная прокрутка вместо
 * переноса, подпись языка и кнопка копирования.
 *
 * Длинные вставки свёрнуты: сотня строк чужого кода не должна выдавливать
 * переписку с экрана.
 */

import { useState } from "react";

/** Со скольких строк блок показывается свёрнутым. */
const COLLAPSE_LINES = 18;

export default function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const lineCount = code.split("\n").length;
  const collapsible = lineCount > COLLAPSE_LINES;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Буфер обмена может быть закрыт политикой — молчим, кнопка просто не сработает. */
    }
  };

  return (
    <div className="my-1.5 overflow-hidden rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-black/30">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 dark:border-white/10 px-2.5 py-1">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {lang || "код"}
          <span className="ml-1.5 normal-case tracking-normal text-neutral-400 dark:text-neutral-500">
            {lineCount} стр.
          </span>
        </span>
        <div className="flex items-center gap-2">
          {collapsible && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
            >
              {expanded ? "Свернуть" : "Развернуть"}
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className="text-[11px] text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
          >
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
      </div>
      {/* Перенос строк выключен намеренно: в коде перенос по словам меняет смысл
          отступов. Вместо него горизонтальная прокрутка. */}
      <pre
        className="overflow-x-auto px-3 py-2 text-[12px] leading-relaxed"
        style={collapsible && !expanded ? { maxHeight: "20rem", overflowY: "auto" } : undefined}
      >
        <code className="whitespace-pre font-mono text-neutral-800 dark:text-neutral-200">{code}</code>
      </pre>
    </div>
  );
}
