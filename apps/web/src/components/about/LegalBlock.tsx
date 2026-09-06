"use client";

/**
 * Блок «Правовая информация» в общей последовательности блоков /about.
 *
 * Компонент намеренно без хуков и без запоминания.
 *
 * История вопроса: ключи блока вычислялись прямо в JSX страницы, объект
 * пересоздавался на каждый рендер и попадал в зависимости useEffect внутри
 * useLegalContent — получался бесконечный цикл запросов и раздел не
 * отрисовывался. Цикл вылечен в самом хуке: теперь в зависимостях
 * эффекта только строка-ключ, и объекты-пропсы его больше не задевают.
 * Поэтому здесь не нужен useMemo — а вместе с ним ушла и жалоба eslint
 * на `JSON.stringify(...)` в списке зависимостей (react-hooks/use-memo требует
 * только простые выражения вида `x` или `x.y.z`).
 *
 * Преобразование данных блока в ключи — чистая и дешёвая операция над
 * несколькими десятками полей, так что считать её на рендер безопасно.
 */

import { legacyLegalOverrides } from "@/lib/legal";
import LegalFooter from "./LegalFooter";

export default function LegalBlock({ data }: { data: unknown }) {
  const block = (data ?? {}) as { defaultExpanded?: boolean };

  return (
    <LegalFooter
      blockOverrides={legacyLegalOverrides(data)}
      defaultExpanded={block.defaultExpanded ?? true}
    />
  );
}
