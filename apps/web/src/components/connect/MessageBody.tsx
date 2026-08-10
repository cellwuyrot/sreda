"use client";

/**
 * Текст сообщения: та же разметка, что и раньше, но длинное сообщение
 * показывается свёрнутым.
 *
 * Без этого одно сообщение на несколько тысяч слов занимало экран целиком:
 * прокрутка канала превращалась в прокрутку одного сообщения, а разговор
 * приходилось искать под ним. Свёрнутый вид оставляет высоту ленты предсказуемой
 * и не мешает читать остальное; порог — в lib/messageLimits.
 *
 * Затемняющей подложки над обрезанным текстом нет намеренно: фон переписки
 * настраивается (тема, фон сообщества), и градиент «в белое» на нём выглядел бы
 * заплаткой. Обрез обозначен рамкой и кнопкой.
 */

import { useState } from "react";
import { renderContent, type RenderOptions } from "./messageFormat";
import { countWords, isLongMessage } from "@/lib/messageLimits";

export default function MessageBody({
  text,
  options,
}: {
  text: string;
  options?: RenderOptions;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!isLongMessage(text)) return <>{renderContent(text, options)}</>;

  const words = countWords(text);

  return (
    <>
      <div
        className={
          expanded
            ? undefined
            : "max-h-[18rem] overflow-hidden border-b border-dashed border-neutral-300 dark:border-white/15"
        }
      >
        {renderContent(text, options)}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-[12px] font-medium text-violet-600 transition-colors hover:text-violet-700 dark:text-cyan-400 dark:hover:text-cyan-300"
      >
        {expanded ? "Свернуть" : `Показать полностью — ${words.toLocaleString("ru-RU")} слов`}
      </button>
    </>
  );
}
