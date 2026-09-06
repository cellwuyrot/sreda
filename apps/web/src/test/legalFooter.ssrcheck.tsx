/**
 * Автономная проверка отображения правовой информации в подвале /about.
 *
 * Основные тесты лежат рядом и запускаются через `npm test`:
 *   • src/lib/legal.test.ts
 *   • src/components/about/LegalFooter.test.tsx
 *
 * Этот файл — тот же набор проверок на чистом React SSR, без vitest и jsdom,
 * чтобы его можно было выполнить в любой среде, где есть react и react-dom:
 *
 *   npx tsx src/test/legalFooter.ssrcheck.tsx
 */

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import LegalFooter, { LegalContactLinks } from "@/components/about/LegalFooter";
import {
  mergeLegalOverrides,
  LEGAL_DEFAULTS,
  LEGAL_SECTIONS,
  legalKeys,
  resolveLegalContent,
} from "@/lib/legal";
import { BLOCK_DEFAULTS, BLOCK_LABELS, BLOCK_TYPES } from "@/lib/aboutBlocks";

let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(
      `       ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Снимает теги и HTML-экранирование, чтобы искать видимый текст. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderFooter() {
  const html = renderToStaticMarkup(<LegalFooter />);
  return {
    html,
    text: visibleText(html),
  };
}

function renderLinks() {
  const html = renderToStaticMarkup(<LegalContactLinks />);
  return {
    html,
    text: visibleText(html),
  };
}

console.log("\nПравовая информация в подвале /about\n");

check("правовой раздел существует и содержит текст", () => {
  const { html, text } = renderFooter();

  assert(
    html.includes('id="legal"'),
    "нет якоря #legal",
  );

  assert(
    text.includes("Правовая информация"),
    "нет подписи раздела",
  );

  assert(
    text.includes(LEGAL_DEFAULTS.heading),
    "нет заголовка соглашения",
  );

  assert(
    text.includes(LEGAL_DEFAULTS.subheading),
    "нет редакции/даты",
  );

  assert(
    text.includes(LEGAL_DEFAULTS.preamble),
    "нет преамбулы",
  );

  assert(
    text.length > 3000,
    `текста подозрительно мало: ${text.length} символов`,
  );
});

check("контакт и официальный сайт отображаются", () => {
  const { html, text } = renderFooter();

  assert(
    html.includes(`mailto:${LEGAL_DEFAULTS.contactEmail}`),
    "нет ссылки на юридический email",
  );

  assert(
    text.includes(LEGAL_DEFAULTS.contactEmail),
    "нет юридического email в тексте",
  );

  assert(
    html.includes(LEGAL_DEFAULTS.contactUrl),
    "нет ссылки на официальный сайт",
  );
});

check("все разделы соглашения присутствуют", () => {
  const { text } = renderFooter();

  assert(
    LEGAL_SECTIONS.length >= 8,
    "ожидалось не менее 8 разделов",
  );

  for (const section of LEGAL_SECTIONS) {
    assert(
      text.includes(section.title),
      `потерян раздел: ${section.title}`,
    );

    const contentPreview = section.content
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);

    assert(
      text.includes(contentPreview),
      `потерян текст раздела: ${section.title}`,
    );
  }

  assert(
    text.length > 5000,
    `полный текст слишком короткий: ${text.length}`,
  );
});

check("resolveLegalContent возвращает полноценную редакцию", () => {
  const content = resolveLegalContent();

  assert(
    content.heading === LEGAL_DEFAULTS.heading,
    "неверный заголовок",
  );

  assert(
    content.subheading === LEGAL_DEFAULTS.subheading,
    "неверный подзаголовок",
  );

  assert(
    content.preamble === LEGAL_DEFAULTS.preamble,
    "неверная преамбула",
  );

  assert(
    content.contactEmail === LEGAL_DEFAULTS.contactEmail,
    "неверный юридический email",
  );

  assert(
    content.contactUrl === LEGAL_DEFAULTS.contactUrl,
    "неверный URL",
  );

  assert(
    content.sections.length === LEGAL_SECTIONS.length,
    "количество разделов изменилось",
  );
});

check("resolveLegalContent устойчив к null и пустому объекту", () => {
  const fallback = resolveLegalContent();

  assert(
    JSON.stringify(resolveLegalContent(null)) ===
      JSON.stringify(fallback),
    "null даёт другой результат",
  );

  assert(
    JSON.stringify(resolveLegalContent({})) ===
      JSON.stringify(fallback),
    "пустой объект даёт другой результат",
  );
});

check("данные из siteConfig заменяют значения по умолчанию", () => {
  const content = resolveLegalContent({
    [legalKeys.heading]: "Оферта из Контента сайта",
    [legalKeys.subheading]: "редакция от 1 января 2027 г.",
    [legalKeys.preamble]:
      "Преамбула, заданная администратором.",
    [legalKeys.contactEmail]: "pravo@trioz.ru",
    [legalKeys.contactUrl]:
      "https://trioz.ru/about",
    [legalKeys.sectionTitle(0)]:
      "1. Свои термины",
    [legalKeys.sectionContent(0)]:
      "Текст первого раздела из админки.",
  });

  assert(
    content.heading === "Оферта из Контента сайта",
    "заголовок из siteConfig не применился",
  );

  assert(
    content.subheading ===
      "редакция от 1 января 2027 г.",
    "подзаголовок не применился",
  );

  assert(
    content.preamble ===
      "Преамбула, заданная администратором.",
    "преамбула не применилась",
  );

  assert(
    content.contactEmail === "pravo@trioz.ru",
    "юридическая почта не применилась",
  );

  assert(
    content.contactUrl ===
      "https://trioz.ru/about",
    "URL не применился",
  );

  assert(
    content.sections[0].title ===
      "1. Свои термины",
    "заголовок первого раздела не применился",
  );

  assert(
    content.sections[0].content ===
      "Текст первого раздела из админки.",
    "текст первого раздела не применился",
  );

  assert(
    content.sections[1].title ===
      LEGAL_SECTIONS[1].title,
    "нетронутый раздел был повреждён",
  );
});

check("пустые значения возвращают текст по умолчанию", () => {
  const content = resolveLegalContent({
    [legalKeys.heading]: "",
    [legalKeys.subheading]: "   ",
    [legalKeys.preamble]: "",
    [legalKeys.contactEmail]: "",
    [legalKeys.contactUrl]: "",
  });

  assert(
    content.heading === LEGAL_DEFAULTS.heading,
    "пустое поле стёрло заголовок",
  );

  assert(
    content.subheading === LEGAL_DEFAULTS.subheading,
    "пустое поле стёрло подзаголовок",
  );

  assert(
    content.preamble === LEGAL_DEFAULTS.preamble,
    "пустое поле стёрло преамбулу",
  );

  assert(
    content.contactEmail ===
      LEGAL_DEFAULTS.contactEmail,
    "пустое поле стёрло email",
  );

  assert(
    content.contactUrl ===
      LEGAL_DEFAULTS.contactUrl,
    "пустое поле стёрло URL",
  );
});

check("mergeLegalOverrides объединяет источники по приоритету", () => {
  const merged = mergeLegalOverrides(
    {
      [legalKeys.heading]: "site",
      [legalKeys.preamble]: "site preamble",
      [legalKeys.contactEmail]: "site@example.com",
    },
    {
      [legalKeys.heading]: "override",
      [legalKeys.preamble]: "override preamble",
    },
    {
      [legalKeys.heading]: "block",
    },
  );

  assert(
    merged[legalKeys.heading] === "block",
    "blockOverrides не имеет высший приоритет",
  );

  assert(
    merged[legalKeys.preamble] === "override preamble",
    "overrides не перебили siteContent",
  );

  assert(
    merged[legalKeys.contactEmail] ===
      "site@example.com",
    "значение из siteContent потеряно",
  );
});

check("mergeLegalOverrides игнорирует пустые значения", () => {
  const merged = mergeLegalOverrides(
    {
      [legalKeys.heading]: "Исходный заголовок",
    },
    {
      [legalKeys.heading]: "",
      [legalKeys.preamble]: "   ",
    },
  );

  assert(
    merged[legalKeys.heading] ===
      "Исходный заголовок",
    "пустое override стерло значение",
  );

  assert(
    !(legalKeys.preamble in merged),
    "пустая преамбула попала в результат",
  );
});

check("LegalFooter реально отображает данные", () => {
  const { html, text } = renderFooter();

  assert(
    text.includes(LEGAL_DEFAULTS.heading),
    "заголовок не попал в SSR",
  );

  assert(
    text.includes(LEGAL_DEFAULTS.preamble),
    "преамбула не попала в SSR",
  );

  assert(
    html.includes(
      `mailto:${LEGAL_DEFAULTS.contactEmail}`,
    ),
    "email не попал в SSR",
  );

  assert(
    html.includes(LEGAL_DEFAULTS.contactUrl),
    "URL не попал в SSR",
  );
});

check(
  "LegalContactLinks содержит ссылку на правовую информацию",
  () => {
    const { html, text } = renderLinks();

    assert(
      html.includes('href="#legal"'),
      "нет якоря #legal",
    );

    assert(
      text.includes("Правовая информация"),
      "нет ссылки «Правовая информация»",
    );

    assert(
      text.includes(LEGAL_DEFAULTS.contactEmail),
      "нет юридического email",
    );

    assert(
      html.includes(
        `mailto:${LEGAL_DEFAULTS.contactEmail}`,
      ),
      "юридический email не кликабелен",
    );
  },
);

check("источник about.* не влияет на правовую информацию", () => {
  const content = resolveLegalContent({
    "about.title": "Заголовок из другого раздела",
    "about.subtitle":
      "Подзаголовок из другого раздела",
  });

  assert(
    content.heading === LEGAL_DEFAULTS.heading,
    "legal подхватил чужой about.title",
  );

  assert(
    content.subheading === LEGAL_DEFAULTS.subheading,
    "legal подхватил чужой about.subtitle",
  );

  assert(
    !content.heading.includes(
      "Заголовок из другого раздела",
    ),
    "обнаружено пересечение источников",
  );
});

/* Проверки структуры /about и админки. */

const pageSrc = readFileSync(
  "src/app/about/page.tsx",
  "utf8",
);

const adminSrc = readFileSync(
  "src/app/admin/about/page.tsx",
  "utf8",
);

check("каждый тип блока имеет обработчик на /about", () => {
  for (const type of BLOCK_TYPES) {
    assert(
      pageSrc.includes(`case '${type}'`) ||
        pageSrc.includes(`case "${type}"`),
      `нет рендера для блока ${type}`,
    );
  }
});

check("каждый тип блока редактируется в админке", () => {
  for (const type of BLOCK_TYPES) {
    assert(
      adminSrc.includes(`case '${type}'`) ||
        adminSrc.includes(`case "${type}"`),
      `нет редактора для блока ${type}`,
    );

    assert(
      BLOCK_LABELS[type] !== undefined,
      `нет подписи для блока ${type}`,
    );

    assert(
      BLOCK_DEFAULTS[type] !== undefined,
      `нет заготовки для блока ${type}`,
    );
  }
});

check("правовая информация не является CMS-блоком", () => {
  assert(
    !(BLOCK_TYPES as readonly string[]).includes(
      "legal",
    ),
    "тип legal всё ещё присутствует в CMS",
  );

  assert(
    !("legal" in BLOCK_DEFAULTS),
    "заготовка legal всё ещё присутствует в CMS",
  );

  assert(
    !("legal" in BLOCK_LABELS),
    "подпись legal всё ещё присутствует в CMS",
  );

  assert(
    !pageSrc.includes('case "legal"') &&
      !pageSrc.includes("case 'legal'"),
    "страница всё ещё обрабатывает legal как CMS-блок",
  );

  assert(
    !pageSrc.includes("<LegalBlock"),
    "старый LegalBlock всё ещё подключён",
  );

  assert(
    pageSrc.includes("<LegalFooter"),
    "LegalFooter не выводится на /about",
  );
});

check("legacy legal-записи не попадают в API CMS-блоков", () => {
  const apiSrc = readFileSync(
    "src/app/api/about-blocks/route.ts",
    "utf8",
  );

  assert(
    apiSrc.includes('type: { not: "legal" }'),
    "API не фильтрует legacy legal",
  );
});

check("правовая информация редактируется отдельно", () => {
  const legalAdmin = readFileSync(
    "src/app/admin/legal/page.tsx",
    "utf8",
  );

  assert(
    legalAdmin.includes("/api/site-content"),
    "редактор legal не использует siteConfig",
  );

  assert(
    !legalAdmin.includes("/admin/about"),
    "legal снова связан с /admin/about",
  );
});

check("в админке /about нет второго LegalEditor", () => {
  assert(
    !adminSrc.includes("function LegalEditor"),
    "LegalEditor всё ещё встроен в About",
  );

  assert(
    !adminSrc.includes('case "legal"') &&
      !adminSrc.includes("case 'legal'"),
    "legal всё ещё редактируется через About",
  );
});

check(
  "правовая информация выводится как отдельный системный раздел",
  () => {
    const { html, text } = renderFooter();

    assert(
      html.includes('id="legal"'),
      "нет системного #legal",
    );

    assert(
      text.includes(LEGAL_DEFAULTS.heading),
      "нет заголовка",
    );

    assert(
      text.includes(LEGAL_DEFAULTS.preamble),
      "нет основного текста",
    );
  },
);

check(
  "контент сайта может переопределять правовой документ",
  () => {
    const content = resolveLegalContent({
      [legalKeys.heading]:
        "Соглашение из Контента сайта",

      [legalKeys.sectionContent(0)]:
        "Текст из раздела Правовая информация.",
    });

    assert(
      content.heading ===
        "Соглашение из Контента сайта",
      "заголовок из siteConfig потерян",
    );

    assert(
      content.sections[0].content ===
        "Текст из раздела Правовая информация.",
      "текст из siteConfig потерян",
    );
  },
);

check("медиа загружается файлом, а не URL", () => {
  assert(
    adminSrc.includes("MediaUploadField"),
    "в админке нет MediaUploadField",
  );

  assert(
    !adminSrc.includes("Аватар URL"),
    "аватар всё ещё задаётся URL",
  );

  const uploadSrc = readFileSync(
    "src/components/admin/MediaUploadField.tsx",
    "utf8",
  );

  assert(
    uploadSrc.includes('type="file"'),
    "нет поля выбора файла",
  );

  assert(
    uploadSrc.includes("/api/about-media"),
    "загрузка не идёт на /api/about-media",
  );
});

check(
  "загруженные медиафайлы используются на /about",
  () => {
    assert(
      pageSrc.includes("hero-bg-image"),
      "фон обложки не рисуется",
    );

    assert(
      pageSrc.includes("hero-bg-video"),
      "видео-фон обложки не рисуется",
    );

    assert(
      pageSrc.includes("data.posterUrl"),
      "posterUrl не используется",
    );

    assert(
      pageSrc.includes("item.imageUrl"),
      "imageUrl карточки не используется",
    );

    assert(
      pageSrc.includes("m.avatarUrl"),
      "avatarUrl команды не используется",
    );
  },
);

console.log(
  failures === 0
    ? "\nВсе SSR-проверки правовой информации прошли.\n"
    : `\nНе прошло проверок: ${failures}\n`,
);

process.exit(failures === 0 ? 0 : 1);