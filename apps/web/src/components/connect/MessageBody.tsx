"use client";

/**
 * Текст сообщения: та же разметка, что и раньше, но длинное сообщение
 * показывается свёрнутым.
 *
 * FIX-EXPANDCRASH: в раскрытом виде вместо renderContent (HTML-разметка с
 * react-элементами) используется простой текст. Это устраняет вылет при выделении
 * мышкой: браузерный Selection API конфликтовал с React-нодами, которые
 * renderContent ставил внутрь span-ов. Простой whitespace-pre-wrap текст в
 * одном <div> Selection трогает без проблем.
 *
 * Свёрнутый вид по-прежнему использует renderContent — там текст обрезан и
 * выделять нечего.
 *
 * Кнопка «Скрыть» добавлена и внизу раскрытого блока, чтобы не нужно было
 * прокручивать наверх.
 */

import { useState } from "react";
import { renderContent, type RenderOptions } from "./messageFormat";
import { countWords, isLongMessage } from "@/lib/messageLimits";

export default function MessageBody({
  text,
  options,
}: {
  /* FIX-DM-COPY: текст бывает пустым и даже null (сообщение только с вложением). */
  text: string | null | undefined;
  options?: RenderOptions;
}) {
  const [expanded, setExpanded] = useState(false);

  const safeText = typeof text === "string" ? text : "";
  if (!safeText) return null;

  if (!isLongMessage(safeText)) return <>{renderContent(safeText, options)}</>;

  const words = countWords(safeText);

  const collapseBtn = (
    <button
      type="button"
      onClick={() => setExpanded(false)}
      className="mt-1 text-[12px] font-medium text-violet-600 transition-colors hover:text-violet-700 dark:text-cyan-400 dark:hover:text-cyan-300"
    >
      Скрыть
    </button>
  );

  return (
    <>
      {expanded ? (
        <>
          {/* FIX-EXPANDCRASH: раскрытое сообщение — plain text, без renderContent.
              React-элементы внутри renderContent (ссылки, mention-span-ы) вступали
              в конфликт с Selection при выделении текста мышкой и приводили к
              вылету. Plain text в одном <div> Selection не ломает. */}
          <div className="whitespace-pre-wrap break-words">{safeText}</div>
          {collapseBtn}
        </>
      ) : (
        <>
          <div className="max-h-[18rem] overflow-hidden border-b border-dashed border-neutral-300 dark:border-white/15">
            {renderContent(safeText, options)}
          </div>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-1 text-[12px] font-medium text-violet-600 transition-colors hover:text-violet-700 dark:text-cyan-400 dark:hover:text-cyan-300"
          >
            {`Показать полностью — ${words.toLocaleString("ru-RU")} слов`}
          </button>
        </>
      )}
    </>
  );
}
