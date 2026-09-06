"use client";

/**

* Системный блок «Правовая информация» страницы /about.
*
* Актуальный контент загружается самим LegalFooter из:
* /api/site-content
*
* Параметр data сохраняется для совместимости с текущей структурой
* страницы /about, но внутри компонента не используется.
  */

import LegalFooter from "./LegalFooter";

export default function LegalBlock({ data: _data }: { data: unknown }) {
return <LegalFooter />;
}
