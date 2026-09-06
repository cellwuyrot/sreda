"use client";

/**
 * Блок «Правовая информация» в общей последовательности блоков /about.
 *
 * Отдельный компонент нужен по двум причинам.
 *
 * 1. Хуки нельзя вызывать внутри renderBlock страницы, а данные блока надо
 *    привести к ключам правовой информации ровно один раз. Раньше это
 *    делалось прямо в JSX (`blockOverrides={legacyLegalOverrides(d)}`) —
 *    объект пересоздавался на каждый рендер и запускал бесконечный цикл
 *    запросов, из-за которого раздел вообще не отрисовывался.
 * 2. Данные блока — единственный источник правды для этого блока. Ключи
 *    siteConfig служат только запасным вариантом для незаполненных полей,
 *    поэтому текст, написанный в «Контент сайта → Правовая информация»,
 *    тоже виден.
 */

import { useMemo } from "react";
import { legacyLegalOverrides } from "@/lib/legal";
import LegalFooter from "./LegalFooter";

export default function LegalBlock({ data }: { data: unknown }) {
  const block = (data ?? {}) as { defaultExpanded?: boolean };

  // Пересчитывается только при реальном изменении данных блока.
  const blockOverrides = useMemo(
    () => legacyLegalOverrides(data),
    [JSON.stringify(data ?? null)],
  );

  return (
    <LegalFooter
      blockOverrides={blockOverrides}
      defaultExpanded={block.defaultExpanded ?? true}
    />
  );
}
