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
import LegalFooter, {
  LegalContactLinks,
} from "@/components/about/LegalFooter";
import {
  LEGAL_CONTACTS,
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

check("все опубликованные почты показаны с подписями", () => {
  const { html, text } = renderFooter();

  assert(html.includes('id="legal-contacts"'), "нет блока контактов");
  assert(text.includes("Контакты администрации"), "нет подписи блока контактов");

  for (const contact of LEGAL_CONTACTS) {
    assert(text.includes(contact.label), `нет названия канала: ${contact.label}`);
    assert(text.includes(contact.email), `нет почты: ${contact.email}`);
    assert(
      html.includes(`mailto:${contact.email}`),
      `почта ${contact.email} не кликабельна`,
    );
    assert(text.includes(contact.hint), `нет пояснения к почте: ${contact.label}`);
  }

  assert(html.includes(LEGAL_DEFAULTS.contactUrl), "нет адреса сайта");
});

check("почты из админки доезжают до сайта", () => {
  const { html, text } = renderFooter({
    overrides: {
      [legalKeys.contactEmail("legal")]: "pravo@trioz.ru",
      [legalKeys.contactLabel("media")]: "Пресс-служба",
      [legalKeys.contactEmail("media")]: "press@trioz.ru",
      [legalKeys.contactUrl]: "https://trioz.ru/about",
    },
  });

  assert(html.includes("mailto:pravo@trioz.ru"), "новая правовая почта не показана");
  assert(html.includes("mailto:press@trioz.ru"), "новая медийная почта не показана");
  assert(text.includes("Пресс-служба"), "новая подпись канала не показана");
  assert(html.includes("https://trioz.ru/about"), "адрес сайта из админки не показан");
  assert(!html.includes("mailto:legal@trioz.ru"), "остался старый адрес из кода");
});

check("колонтитул берёт те же почты, что и блок правовой информации", () => {
  const overrides = {
    [legalKeys.contactEmail("legal")]: "pravo@trioz.ru",
    [legalKeys.contactEmail("media")]: "press@trioz.ru",
  };

  const links = renderToStaticMarkup(<LegalContactLinks overrides={overrides} />);
  const linksText = visibleText(links);

  assert(links.includes("mailto:pravo@trioz.ru"), "в колонтитуле нет правовой почты");
  assert(links.includes("mailto:press@trioz.ru"), "в колонтитуле нет медийной почты");
  assert(
    !links.includes("mailto:legal@trioz.ru"),
    "колонтитул остался с жёстко вбитым адресом",
  );
  assert(
    linksText.includes("Медийные запросы: press@trioz.ru"),
    "в колонтитуле почта без назначения",
  );
  assert(links.includes(LEGAL_DEFAULTS.contactUrl), "в колонтитуле нет адреса сайта");
});

check("блоки «О проекте» и правовая информация — разные источники", () => {
  // Ключи блоков «О проекте» хранятся в таблице AboutBlock и никак не
  // влияют на подвал: лишние значения siteConfig не должны его ломать.
  const { text } = renderFooter({
    overrides: {
      "about.title": "Заголовок из другого раздела",
      "about.subtitle": "Подзаголовок из другого раздела",
    },
  });

  assert(text.includes(LEGAL_DEFAULTS.heading), "правовой блок потерял заголовок");
  assert(
    !text.includes("Заголовок из другого раздела"),
    "подвал подхватил чужие настройки",
  );
  assert(text.includes(LEGAL_CONTACTS[0].email), "потеряны контакты");
});

console.log(
  failures === 0
    ? "\nВсе проверки отображения прошли.\n"
    : `\nНе прошло проверок: ${failures}\n`,
);

process.exit(failures === 0 ? 0 : 1);
