/**
 * Автономный прогон отображения раздела /about.
 *
 * Запуск: ./node_modules/.bin/tsx src/test/legalFooter.ssrcheck.tsx
 *
 * Проверяется три вещи:
 *   1. чистая логика раскладки и слияния двух разделов админки;
 *   2. настоящий HTML, в который рендерится подвал;
 *   3. разводка в исходниках страницы и админки (анти-регрессии).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import LegalFooter from "../components/about/LegalFooter";
import {
  LEGAL_DEFAULTS,
  LEGAL_SECTIONS,
  legalBlockOverrides,
  legalKeys,
  mergeLegalOverrides,
  resolveLegalContent,
} from "../lib/legal";
import {
  BLOCK_DEFAULTS,
  BLOCK_LABELS,
  BLOCK_TYPES,
  buildAboutLayout,
  type AboutBlockRow,
} from "../lib/aboutBlocks";

let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(error as Error).message}`);
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#([0-9]+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const row = (
  id: string,
  type: string,
  data: unknown,
  visible = true,
  position = 0,
): AboutBlockRow =>
  ({ id, type, position, data, visible, createdAt: "", updatedAt: "" }) as AboutBlockRow;

const siteContent: Record<string, string> = {
  [legalKeys.heading]: "Соглашение из Контента сайта",
  [legalKeys.preamble]: "Преамбула, заполненная в разделе Правовая информация.",
  [legalKeys.contactEmail]: "pravo@trioz.ru",
  [legalKeys.sectionContent(0)]: "Текст первого раздела из админки.",
};

const legalBlockData = {
  heading: "",
  subheading: "Редакция из блока О проекте",
  preamble: "",
  contactUrl: "https://about.trioz.ru",
  sections: [{ title: "1. Свой заголовок из блока", content: "" }],
};

console.log("\nПравовая информация в подвале /about\n");

check("правовая информация не рисуется среди обычных блоков", () => {
  const layout = buildAboutLayout([
    row("a", "hero", {}),
    row("b", "legal", legalBlockData),
    row("c", "cta", {}),
  ]);
  assert(layout.bodyBlocks.length === 2, "в теле должны остаться два блока");
  assert(layout.bodyBlocks.every((b) => b.type !== "legal"), "legal попал в тело страницы");
  assert(layout.legalBlock?.id === "b", "legal-блок не попал в подвал");
});

check("позиция в админке не выносит документ из подвала", () => {
  const layout = buildAboutLayout([
    row("legal", "legal", legalBlockData, true, 0),
    row("hero", "hero", {}, true, 1),
  ]);
  assert(layout.bodyBlocks[0]?.id === "hero", "первым в теле должен идти hero");
  assert(layout.legalBlock?.id === "legal", "документ потерян");
});

check("документ не дублируется при нескольких legal-блоках", () => {
  const layout = buildAboutLayout([
    row("l1", "legal", legalBlockData),
    row("l2", "legal", legalBlockData),
  ]);
  assert(layout.bodyBlocks.length === 0, "дубликат утёк в тело страницы");
  assert(layout.legalBlock?.id === "l1", "взят не первый блок");
});

check("выключенные блоки не показываются", () => {
  const layout = buildAboutLayout([
    row("hidden", "hero", {}, false),
    row("legal", "legal", legalBlockData, false),
  ]);
  assert(layout.bodyBlocks.length === 0, "скрытый блок показан");
  assert(layout.legalBlock === null, "скрытый legal-блок показан");
});

check("пустая база не ломает страницу", () => {
  for (const input of [null, undefined, []]) {
    const layout = buildAboutLayout(input as AboutBlockRow[] | null);
    assert(layout.bodyBlocks.length === 0, "ожидался пустой список");
    assert(layout.legalBlock === null, "ожидался отсутствующий блок");
  }
});

check("пустые поля блока не попадают в ключи", () => {
  const keys = legalBlockOverrides(legalBlockData);
  assert(!(legalKeys.heading in keys), "пустой заголовок попал в ключи");
  assert(!(legalKeys.preamble in keys), "пустая преамбула попала в ключи");
  assert(keys[legalKeys.subheading] === "Редакция из блока О проекте", "подзаголовок потерян");
  assert(keys[legalKeys.sectionTitle(0)] === "1. Свой заголовок из блока", "заголовок раздела потерян");
  assert(!(legalKeys.sectionContent(0) in keys), "пустой текст раздела попал в ключи");
});

check("разделы дополняют друг друга, а не затирают", () => {
  const content = resolveLegalContent(
    mergeLegalOverrides(siteContent, null, legalBlockOverrides(legalBlockData)),
  );
  assert(content.heading === "Соглашение из Контента сайта", "заголовок из админки потерян");
  assert(content.contactEmail === "pravo@trioz.ru", "почта из админки потеряна");
  assert(content.sections[0].content === "Текст первого раздела из админки.", "текст раздела из админки потерян");
  assert(content.subheading === "Редакция из блока О проекте", "подзаголовок из блока потерян");
  assert(content.contactUrl === "https://about.trioz.ru", "сайт из блока потерян");
  assert(content.sections[0].title === "1. Свой заголовок из блока", "заголовок из блока потерян");
  assert(content.sections[7].title === LEGAL_SECTIONS[7].title, "последний раздел потерян");
});

check("без блока текст из Контента сайта всё равно виден", () => {
  const content = resolveLegalContent(mergeLegalOverrides(siteContent, null, null));
  assert(content.heading === "Соглашение из Контента сайта", "заголовок потерян");
  assert(content.subheading === LEGAL_DEFAULTS.subheading, "подзаголовок по умолчанию потерян");
  assert(content.sections.length === LEGAL_SECTIONS.length, "потеряны разделы");
});

check("пустая админка даёт редакцию по умолчанию", () => {
  for (const input of [null, undefined, {}]) {
    const content = resolveLegalContent(input as Record<string, string> | null);
    assert(content.heading === LEGAL_DEFAULTS.heading, "заголовок потерян");
    assert(content.sections.length === 8, "разделы потеряны");
  }
});

check("мусор в данных блока не роняет страницу", () => {
  for (const input of [null, undefined, "строка", 42, [], { sections: "не массив" }, { sections: [null, 5] }]) {
    const keys = legalBlockOverrides(input);
    assert(typeof keys === "object", "ожидался объект");
  }
});

const htmlMerged = renderToStaticMarkup(
  <LegalFooter siteOverrides={siteContent} blockOverrides={legalBlockOverrides(legalBlockData)} />,
);
const textMerged = visibleText(htmlMerged);
const htmlDefaults = renderToStaticMarkup(<LegalFooter />);
const textDefaults = visibleText(htmlDefaults);

check("подвал не пустой даже без данных", () => {
  assert(htmlDefaults.includes('id="legal"'), "нет секции #legal");
  assert(textDefaults.includes(LEGAL_DEFAULTS.heading), "нет заголовка документа");
  assert(textDefaults.length > 3000, `текста подозрительно мало: ${textDefaults.length}`);
});

check("все восемь разделов соглашения есть в HTML", () => {
  LEGAL_SECTIONS.forEach((section, i) => {
    const expected = i === 0 ? "1. Свой заголовок из блока" : section.title;
    assert(textMerged.includes(expected), `нет раздела: ${expected}`);
  });
});

check("текст из Контента сайта виден в HTML", () => {
  assert(textMerged.includes("Соглашение из Контента сайта"), "нет заголовка из админки");
  assert(textMerged.includes("Преамбула, заполненная в разделе"), "нет преамбулы из админки");
  assert(textMerged.includes("Текст первого раздела из админки."), "нет текста раздела из админки");
  assert(htmlMerged.includes("mailto:pravo@trioz.ru"), "нет почты из админки");
});

check("текст из блока О проекте виден в том же HTML", () => {
  assert(textMerged.includes("Редакция из блока О проекте"), "нет подзаголовка из блока");
  assert(htmlMerged.includes("https://about.trioz.ru"), "нет ссылки из блока");
});

check("текст виден сразу, без клика и аккордеона", () => {
  assert(!/<details/i.test(htmlMerged), "документ спрятан в <details>");
  assert(!/aria-expanded="false"/.test(htmlMerged), "документ свёрнут");
  assert(!/display:\s*none/.test(htmlMerged), "текст спрятан стилями");
  assert(htmlMerged.includes('id="legal-sections"'), "нет контейнера разделов");
});

check("документ в HTML ровно один", () => {
  const count = htmlMerged.split('id="legal"').length - 1;
  assert(count === 1, `секций #legal: ${count}`);
});

check("контакты администрации показаны с подписями", () => {
  assert(htmlMerged.includes('id="legal-contacts"'), "нет блока контактов");
  assert(textMerged.includes("Юридические обращения"), "нет подписи юридической почты");
  assert(textMerged.includes("Официальный сайт"), "нет подписи сайта");
});

const pageSrc = readFileSync("src/app/about/page.tsx", "utf8");
const adminSrc = readFileSync("src/app/admin/content/page.tsx", "utf8");
const hookSrc = readFileSync("src/components/about/useLegalContent.ts", "utf8");
const footerSrc = readFileSync("src/components/about/LegalFooter.tsx", "utf8");

check("страница рисует тело и подвал по раскладке", () => {
  assert(pageSrc.includes("buildAboutLayout(blocks)"), "раскладка не используется");
  assert(pageSrc.includes("{bodyBlocks.map(renderBlock)}"), "тело страницы рисует не bodyBlocks");
  assert(!pageSrc.includes("{blocks.map(renderBlock)}"), "остался старый рендер блоков");
  assert(pageSrc.includes("<LegalFooter blockOverrides={legalOverrides} />"), "подвал не получает данные блока");
});

check("подвал рисуется безусловно", () => {
  const idx = pageSrc.indexOf("<LegalFooter");
  const before = pageSrc.slice(Math.max(0, idx - 120), idx);
  assert(!before.includes("&&"), "подвал спрятан за условием");
});

check("legal не рисуется второй раз в теле страницы", () => {
  assert(pageSrc.includes("case 'legal':"), "нет явного case 'legal'");
  const idx = pageSrc.indexOf("case 'legal':");
  assert(pageSrc.slice(idx, idx + 400).includes("return null"), "legal рисуется в теле страницы");
});

check("блок правовой информации заведён полноценно", () => {
  assert(BLOCK_TYPES.includes("legal"), "legal нет в списке типов");
  assert(typeof BLOCK_LABELS.legal === "string" && BLOCK_LABELS.legal.length > 0, "нет названия блока");
  assert(BLOCK_DEFAULTS.legal !== undefined, "нет дефолтов блока");
});

check("новый блок пустой и ничего не затирает", () => {
  const keys = legalBlockOverrides(BLOCK_DEFAULTS.legal);
  assert(Object.keys(keys).length === 0, `дефолтные поля перебивают админку: ${Object.keys(keys)}`);
  const content = resolveLegalContent(mergeLegalOverrides(siteContent, null, keys));
  assert(content.heading === "Соглашение из Контента сайта", "пустой блок стёр текст админки");
});

check("все типы блоков редактируются в админке", () => {
  for (const type of BLOCK_TYPES) {
    if (type === "apps") continue;
    assert(adminSrc.includes(`case '${type}':`), `нет редактора для блока: ${type}`);
  }
  assert(adminSrc.includes("function LegalEditor"), "нет редактора правовой информации");
});

check("админка объясняет связь двух разделов", () => {
  assert(adminSrc.includes("/admin/legal"), "нет ссылки на редактор правовой информации");
  assert(adminSrc.includes("дополняют"), "нет пояснения про дополнение");
});

check("единственный запрос без бесконечного цикла", () => {
  assert(!hookSrc.includes("/api/about-blocks"), "хук сам догружает блоки");
  assert((hookSrc.match(/fetch\(/g) ?? []).length === 1, "больше одного запроса");
  assert(hookSrc.includes("}, []);"), "зависимости эффекта не пусты");
  assert(!/\[\s*JSON\.stringify/.test(hookSrc), "вызов функции в зависимостях — упадёт lint");
  assert(!/\[\s*JSON\.stringify/.test(footerSrc), "вызов функции в зависимостях подвала");
});

check("единый источник текста для подвала и ссылок", () => {
  assert(footerSrc.includes('from "./useLegalContent"'), "подвал не использует общий хук");
  assert(!footerSrc.includes("function useSiteLegalOverrides"), "в подвале второй загрузчик");
  assert((footerSrc.match(/fetch\(/g) ?? []).length === 0, "подвал грузит данные сам");
});

writeFileSync(
  "/data/about-legal-preview.html",
  `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><title>/about</title></head>\n<body style="background:#07090f;color:#fff">\n${htmlMerged}\n</body></html>\n`,
  "utf8",
);
writeFileSync("/data/about-legal-preview.txt", htmlMerged, "utf8");

console.log("\nДлина видимого текста в подвале:", textMerged.length, "символов");
console.log(
  failures === 0 ? "\nВсе проверки отображения прошли.\n" : `\nНе прошло проверок: ${failures}\n`,
);
process.exit(failures === 0 ? 0 : 1);
