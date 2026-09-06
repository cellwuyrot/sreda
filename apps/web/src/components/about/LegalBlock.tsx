```tsx
"use client";

/**
 * Системный блок «Правовая информация» страницы /about.
 *
 * Актуальный контент загружается самим LegalFooter из:
 * /api/site-content
 *
 * Файл сохранён как отдельный блок-обёртка, чтобы не менять структуру
 * страницы /about и существующую последовательность блоков.
 */

import LegalFooter from "./LegalFooter";

export default function LegalBlock({ data: _data }: { data: unknown }) {
  return <LegalFooter />;
}
```
