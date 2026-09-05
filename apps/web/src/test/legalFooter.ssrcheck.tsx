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
import { renderToStaticMarkup } from "react-dom/server";
import LegalFooter from "@/components/about/LegalFooter";
import {
  LEGAL_DEFAULTS,
  LEGAL_SECTIONS,
  legalKeys,
  resolveLegalContent,
} from "@/lib/legal";

let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(e as Error).message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
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

function renderFooter(props: Parameters<typeof LegalFooter>[0] = {}) {
  const html = renderToStaticMarkup(<LegalFooter {...props} />);
  return { html, text: visibleText(html) };
}

console.log("\nПравовая информация в подвале /about\n");

check("свёрнутый раздел уже содержит текст (подвал не пустой)", () => {
  const { html, text } = renderFooter();

  assert(html.includes('id="legal"'), "нет якоря #legal для ссылки из колонтитула");
  assert(text.includes("Правовая информация"), "нет подписи раздела");
  assert(text.includes(LEGAL_DEFAULTS.heading), "нет заголовка соглашения");
  assert(text.includes(visibleText(LEGAL_DEFAULTS.subheading)), "нет редакции/даты");
  assert(text.length > 400, `текста подозрительно мало: ${text.length} символов`);
});

check("контакты для юридических запросов на виду", () => {
  const { html } = renderFooter();
  assert(
    html.includes(`mailto:${LEGAL_DEFAULTS.contactEmail}`),
    "нет почты для юридических запросов",
  );
  assert(html.includes(LEGAL_DEFAULTS.contactUrl), "нет ссылки на сайт владельца");
});

check("полный документ содержит все разделы соглашения", () => {
  const { html, text } = renderFooter({ defaultExpanded: true });

  assert(html.includes('id="legal-sections"'), "нет контейнера разделов");
  assert(LEGAL_SECTIONS.length >= 8, "ожидался большой документ");

  for (const section of LEGAL_SECTIONS) {
    assert(text.includes(visibleText(section.title)), `потерян раздел: ${section.title}`);
    const head = visibleText(section.content).slice(0, 60);
    assert(text.includes(head), `потерян текст раздела: ${section.title}`);
  }

  assert(text.length > 5000, `полный текст слишком короткий: ${text.length}`);
});

check("кнопка раскрытия подписана и доступна", () => {
  const collapsed = renderFooter();
  const expanded = renderFooter({ defaultExpanded: true });

  assert(collapsed.text.includes("Читать полный текст соглашения"), "нет кнопки раскрытия");
  assert(collapsed.html.includes('aria-expanded="false"'), "aria-expanded не false");
  assert(expanded.text.includes("Свернуть документ"), "нет кнопки свёртывания");
  assert(expanded.html.includes('aria-expanded="true"'), "aria-expanded не true");
  assert(
    !collapsed.text.includes(visibleText(LEGAL_SECTIONS[0].title)),
    "свёрнутый документ не должен показывать разделы",
  );
});

check("текст из админки показывается на сайте", () => {
  const { text } = renderFooter({
    defaultExpanded: true,
    overrides: {
      [legalKeys.heading]: "Оферта из админки",
      [legalKeys.subheading]: "редакция от 1 января 2027 г.",
      [legalKeys.preamble]: "Преамбула, заданная администратором.",
      [legalKeys.sectionTitle(0)]: "1. Свои термины",
      [legalKeys.sectionContent(0)]: "Текст первого раздела из админки.",
    },
  });

  assert(text.includes("Оферта из админки"), "заголовок из админки не показан");
  assert(text.includes("редакция от 1 января 2027 г."), "подзаголовок не показан");
  assert(text.includes("Преамбула, заданная администратором."), "преамбула не показана");
  assert(text.includes("1. Свои термины"), "заголовок раздела не показан");
  assert(text.includes("Текст первого раздела из админки."), "текст раздела не показан");
  assert(text.includes(visibleText(LEGAL_SECTIONS[1].title)), "потерян нетронутый раздел");
});

check("пустые поля в админке возвращают текст по умолчанию", () => {
  const { text } = renderFooter({
    overrides: { [legalKeys.heading]: "", [legalKeys.subheading]: "   " },
  });

  assert(text.includes(LEGAL_DEFAULTS.heading), "пустое поле стёрло заголовок");
  assert(
    text.includes(visibleText(LEGAL_DEFAULTS.subheading)),
    "пустое поле стёрло подзаголовок",
  );
});

check("resolveLegalContent устойчив к null и пустому ответу API", () => {
  const fallback = resolveLegalContent();
  assert(
    JSON.stringify(resolveLegalContent(null)) === JSON.stringify(fallback),
    "null даёт другой результат",
  );
  assert(
    JSON.stringify(resolveLegalContent({})) === JSON.stringify(fallback),
    "пустой ответ даёт другой результат",
  );
  assert(fallback.sections.length === LEGAL_SECTIONS.length, "потеряны разделы");
});

console.log(
  failures === 0
    ? "\nВсе проверки отображения прошли.\n"
    : `\nНе прошло проверок: ${failures}\n`,
);

process.exit(failures === 0 ? 0 : 1);
