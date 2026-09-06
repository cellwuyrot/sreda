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
import { parseBlockData, serializeBlockData } from "../lib/blockData";

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

const pageSrc = readFileSync("src/components/about/AboutPageClient.tsx", "utf8");
const adminSrc = readFileSync("src/app/admin/content/page.tsx", "utf8");
const hookSrc = readFileSync("src/components/about/useLegalContent.ts", "utf8");
const footerSrc = readFileSync("src/components/about/LegalFooter.tsx", "utf8");

check("страница рисует тело и подвал по раскладке", () => {
  const serverSrc = readFileSync("src/app/about/page.tsx", "utf8");
  assert(serverSrc.includes("buildAboutLayout(blocks)"), "раскладка не используется");
  assert(pageSrc.includes("{bodyBlocks.map(renderBlock)}"), "тело страницы рисует не bodyBlocks");
  assert(!pageSrc.includes("{blocks.map(renderBlock)}"), "остался старый рендер блоков");
  assert(pageSrc.includes("<LegalFooter blockOverrides={legalOverrides}"), "подвал не получает данные блока");
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

check("API \u0440\u0430\u0437\u0440\u0435\u0448\u0430\u0435\u0442 \u0441\u043e\u0437\u0434\u0430\u0432\u0430\u0442\u044c \u0438 \u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0431\u043b\u043e\u043a \u043f\u0440\u0430\u0432\u043e\u0432\u043e\u0439 \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u0438", () => {
  const apiSrc = readFileSync("src/app/api/about-blocks/route.ts", "utf8");
  assert(!apiSrc.includes("no longer supported"), "API \u043e\u0442\u043a\u043b\u043e\u043d\u044f\u0435\u0442 \u0431\u043b\u043e\u043a legal");
  assert(!/not:\s*["']legal["']/.test(apiSrc), "API \u0432\u044b\u0440\u0435\u0437\u0430\u0435\u0442 legal \u0438\u0437 \u0432\u044b\u0434\u0430\u0447\u0438");
  assert(!/body\.type === ["']legal["']/.test(apiSrc), "\u0432 API \u043e\u0441\u0442\u0430\u043b\u0430\u0441\u044c \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043d\u0430 legal");
});

check("\u0441\u043a\u0440\u044b\u0442\u044b\u0435 \u0431\u043b\u043e\u043a\u0438 \u0444\u0438\u043b\u044c\u0442\u0440\u0443\u044e\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u043e \u0432\u0438\u0434\u0438\u043c\u043e\u0441\u0442\u0438", () => {
  const apiSrc = readFileSync("src/app/api/about-blocks/route.ts", "utf8");
  assert(apiSrc.includes("{ visible: true }"), "\u043f\u0443\u0431\u043b\u0438\u0447\u043d\u0430\u044f \u0432\u044b\u0434\u0430\u0447\u0430 \u0444\u0438\u043b\u044c\u0442\u0440\u0443\u0435\u0442\u0441\u044f \u0438\u043d\u0430\u0447\u0435");
});

check("\u0434\u0430\u043d\u043d\u044b\u0435 \u0431\u043b\u043e\u043a\u0430 \u0440\u0430\u0437\u0431\u0438\u0440\u0430\u044e\u0442\u0441\u044f \u0432 \u043b\u044e\u0431\u043e\u043c \u0432\u0438\u0434\u0435", () => {
  const want = { items: [{ label: "\u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u043e\u0432", value: "1200" }] };
  assert(JSON.stringify(parseBlockData(want)) === JSON.stringify(want), "\u043e\u0431\u044a\u0435\u043a\u0442 \u0438\u0441\u043a\u0430\u0436\u0451\u043d");
  assert(JSON.stringify(parseBlockData(JSON.stringify(want))) === JSON.stringify(want), "\u0441\u0442\u0440\u043e\u043a\u0430 \u043d\u0435 \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u043d\u0430");
  assert(JSON.stringify(parseBlockData(JSON.stringify(JSON.stringify(want)))) === JSON.stringify(want), "\u0434\u0432\u043e\u0439\u043d\u043e\u0435 \u043a\u043e\u0434\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u043d\u0435 \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u043d\u043e");
  for (const junk of [null, undefined, "", "   ", "\u043d\u0435 json", "[1,2]", 42, true]) {
    const out = parseBlockData(junk);
    assert(out !== null && typeof out === "object" && !Array.isArray(out), "\u043c\u0443\u0441\u043e\u0440 \u0434\u0430\u043b \u043d\u0435 \u043e\u0431\u044a\u0435\u043a\u0442");
  }
});

check("\u0437\u0430\u043f\u0438\u0441\u044c \u043d\u0435 \u0441\u043e\u0437\u0434\u0430\u0451\u0442 \u0432\u0442\u043e\u0440\u043e\u0439 \u0441\u043b\u043e\u0439 \u043a\u043e\u0434\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f", () => {
  const want = { title: "\u0422\u0440\u0435\u0439\u043b\u0435\u0440" };
  assert(serializeBlockData(want) === JSON.stringify(want), "\u043e\u0431\u044a\u0435\u043a\u0442 \u0437\u0430\u043a\u043e\u0434\u0438\u0440\u043e\u0432\u0430\u043d \u043d\u0435\u0432\u0435\u0440\u043d\u043e");
  assert(serializeBlockData(JSON.stringify(want)) === JSON.stringify(want), "\u0441\u0442\u0440\u043e\u043a\u0430 \u0437\u0430\u043a\u043e\u0434\u0438\u0440\u043e\u0432\u0430\u043d\u0430 \u0434\u0432\u0430\u0436\u0434\u044b");
  assert(JSON.parse(serializeBlockData(want)).title === "\u0422\u0440\u0435\u0439\u043b\u0435\u0440", "\u043a\u0440\u0443\u0433\u043e\u0432\u043e\u0439 \u043e\u0431\u043e\u0440\u043e\u0442 \u0431\u0438\u0442");
});

check("\u0432\u0441\u0435 \u0431\u043b\u043e\u043a\u0438 \u0434\u043e\u0435\u0437\u0436\u0430\u044e\u0442 \u0441 \u0434\u0430\u043d\u043d\u044b\u043c\u0438, \u0430 \u043d\u0435 \u0442\u043e\u043b\u044c\u043a\u043e hero", () => {
  const rows: AboutBlockRow[] = BLOCK_TYPES.filter((t) => t !== "legal").map((t, i) =>
    // данные специально в виде дважды закодированной строки — как в базе
    row("b" + i, t, JSON.stringify(JSON.stringify(BLOCK_DEFAULTS[t])) as unknown as Record<string, unknown>, true, i),
  );
  const { bodyBlocks } = buildAboutLayout(rows);
  assert(bodyBlocks.length === rows.length, "\u0431\u043b\u043e\u043a\u0438 \u043f\u043e\u0442\u0435\u0440\u044f\u043b\u0438\u0441\u044c \u0432 \u0440\u0430\u0441\u043a\u043b\u0430\u0434\u043a\u0435");
  for (const block of bodyBlocks) {
    const d = block.data as Record<string, unknown>;
    assert(d !== null && typeof d === "object" && !Array.isArray(d), block.type + ": \u0434\u0430\u043d\u043d\u044b\u0435 \u043d\u0435 \u043e\u0431\u044a\u0435\u043a\u0442");
    assert(Object.keys(d).length > 0, block.type + ": \u0434\u0430\u043d\u043d\u044b\u0435 \u043e\u043a\u0430\u0437\u0430\u043b\u0438\u0441\u044c \u043f\u0443\u0441\u0442\u044b\u043c\u0438");
    const expected = BLOCK_DEFAULTS[block.type as keyof typeof BLOCK_DEFAULTS] as Record<string, unknown>;
    assert(JSON.stringify(d) === JSON.stringify(expected), block.type + ": \u0434\u0430\u043d\u043d\u044b\u0435 \u0438\u0441\u043a\u0430\u0436\u0435\u043d\u044b");
  }
});

check("\u0431\u043b\u043e\u043a\u0438 \u0441 \u0441\u043f\u0438\u0441\u043a\u0430\u043c\u0438 \u043f\u0440\u043e\u0445\u043e\u0434\u044f\u0442 \u0437\u0430\u0449\u0438\u0442\u0443 items?.length", () => {
  // gallery и apps по задумке пусты и скрыты, пока админ не добавит медиа.
  for (const type of ["stats", "bento", "timeline", "team"] as const) {
    const [only] = buildAboutLayout([
      row("x", type, JSON.stringify(BLOCK_DEFAULTS[type]) as unknown as Record<string, unknown>),
    ]).bodyBlocks;
    const d = only.data as { items?: unknown[]; members?: unknown[] };
    const list = d.items ?? d.members;
    assert(Array.isArray(list) && list.length > 0, type + ": \u0441\u043f\u0438\u0441\u043e\u043a \u043f\u0443\u0441\u0442 \u2014 \u0431\u043b\u043e\u043a \u0432\u0435\u0440\u043d\u0451\u0442 null");
  }
});

check("\u043f\u0440\u0430\u0432\u043e\u0432\u043e\u0439 \u0431\u043b\u043e\u043a \u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044f \u0434\u0430\u0436\u0435 \u0438\u0437 \u0441\u0442\u0440\u043e\u043a\u0438", () => {
  const { legalBlock } = buildAboutLayout([
    row("L", "legal", JSON.stringify(legalBlockData) as unknown as Record<string, unknown>),
  ]);
  assert(legalBlock !== null, "\u043f\u0440\u0430\u0432\u043e\u0432\u043e\u0439 \u0431\u043b\u043e\u043a \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d");
  const ov = legalBlockOverrides(legalBlock!.data);
  assert(ov[legalKeys.subheading] === "\u0420\u0435\u0434\u0430\u043a\u0446\u0438\u044f \u0438\u0437 \u0431\u043b\u043e\u043a\u0430 \u041e \u043f\u0440\u043e\u0435\u043a\u0442\u0435", "\u0442\u0435\u043a\u0441\u0442 \u0438\u0437 \u0441\u0442\u0440\u043e\u043a\u0438 \u043d\u0435 \u0434\u043e\u0448\u0451\u043b");
});

check("\u0432 \u043a\u043e\u0434\u0435 \u043d\u0435 \u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u043c\u043e\u043b\u0447\u0430\u043b\u0438\u0432\u043e\u0433\u043e JSON.parse(data)", () => {
  for (const file of [
    "src/app/api/about-blocks/route.ts",
    "src/app/api/admin/about-blocks/route.ts",
    "src/app/api/admin/about-blocks/[id]/route.ts",
  ]) {
    const src = readFileSync(file, "utf8");
    assert(!/JSON\.parse\(b\.data\)/.test(src), file + ": \u043e\u0441\u0442\u0430\u043b\u0441\u044f \u0441\u044b\u0440\u043e\u0439 JSON.parse");
    assert(src.includes("parseBlockData"), file + ": \u043d\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442 parseBlockData");
    assert(!/JSON\.stringify\(body\.data/.test(src) && !/JSON\.stringify\(body\.data \?\? \{\}\)/.test(src), file + ": \u0437\u0430\u043f\u0438\u0441\u044c \u043c\u0438\u043c\u043e serializeBlockData");
  }
});

check("\u0430\u0434\u043c\u0438\u043d\u0441\u043a\u0430\u044f \u0432\u044b\u0434\u0430\u0447\u0430 \u0431\u043b\u043e\u043a\u043e\u0432 \u0437\u0430\u0449\u0438\u0449\u0435\u043d\u0430", () => {
  const src = readFileSync("src/app/api/admin/about-blocks/route.ts", "utf8");
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  assert(get.includes("role") && get.includes("Forbidden"), "GET \u043e\u0442\u0434\u0430\u0451\u0442 \u0431\u043b\u043e\u043a\u0438 \u0431\u0435\u0437 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u043f\u0440\u0430\u0432");
});

check("\u043c\u0435\u0434\u0438\u0430-\u0431\u043b\u043e\u043a\u0438 \u0433\u043e\u0442\u043e\u0432\u044b \u043a \u043d\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044e", () => {
  for (const type of ["gallery", "apps"] as const) {
    const [only] = buildAboutLayout([
      row("m", type, JSON.stringify(JSON.stringify(BLOCK_DEFAULTS[type])) as unknown as Record<string, unknown>),
    ]).bodyBlocks;
    const d = only.data as { title?: string; items?: unknown[] };
    assert(Array.isArray(d.items), type + ": items \u043d\u0435 \u043c\u0430\u0441\u0441\u0438\u0432");
    assert(typeof d.title === "string" && d.title.length > 0, type + ": \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a \u043f\u043e\u0442\u0435\u0440\u044f\u043d");
  }
});

check("\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 /about \u0440\u0438\u0441\u0443\u0435\u0442\u0441\u044f \u043d\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435", () => {
  const pageRaw = readFileSync("src/app/about/page.tsx", "utf8");
  const page = pageRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(!page.includes('"use client"'), "\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0432\u0441\u0451 \u0435\u0449\u0451 \u043a\u043b\u0438\u0435\u043d\u0442\u0441\u043a\u0430\u044f");
  assert(/export default async function AboutPage/.test(page), "\u043d\u0435\u0442 \u0430\u0441\u0438\u043d\u0445\u0440\u043e\u043d\u043d\u043e\u0433\u043e \u0441\u0435\u0440\u0432\u0435\u0440\u043d\u043e\u0433\u043e \u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442\u0430");
  assert(!/fetch\(/.test(page), "\u0441\u0435\u0440\u0432\u0435\u0440\u043d\u0430\u044f \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0445\u043e\u0434\u0438\u0442 \u0447\u0435\u0440\u0435\u0437 fetch");
  assert(page.includes("buildAboutLayout"), "\u0440\u0430\u0441\u043a\u043b\u0430\u0434\u043a\u0430 \u043d\u0435 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044f \u043d\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435");
  assert(page.includes("legalBlockOverrides"), "\u043f\u0440\u0430\u0432\u043e\u0432\u044b\u0435 \u043a\u043b\u044e\u0447\u0438 \u043d\u0435 \u0441\u043e\u0431\u0438\u0440\u0430\u044e\u0442\u0441\u044f \u043d\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435");
  assert(page.includes('dynamic = "force-dynamic"'), "\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043c\u043e\u0436\u0435\u0442 \u0437\u0430\u043a\u0435\u0448\u0438\u0440\u043e\u0432\u0430\u0442\u044c\u0441\u044f");
  assert(page.includes("siteOverrides"), "\u043f\u0440\u0430\u0432\u043e\u0432\u043e\u0439 \u0442\u0435\u043a\u0441\u0442 \u043d\u0435 \u043f\u0435\u0440\u0435\u0434\u0430\u0451\u0442\u0441\u044f \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u0430");
});

check("\u0442\u0435\u043a\u0441\u0442 \u043d\u0435 \u0437\u0430\u0432\u0438\u0441\u0438\u0442 \u043e\u0442 \u043a\u043b\u0438\u0435\u043d\u0442\u0441\u043a\u043e\u0433\u043e \u0437\u0430\u043f\u0440\u043e\u0441\u0430", () => {
  const client = readFileSync("src/components/about/AboutPageClient.tsx", "utf8");
  const code = client.slice(client.indexOf("export type AboutPageClientProps"));
  assert(!/fetch\(/.test(code), "\u0432 \u0440\u0430\u0437\u043c\u0435\u0442\u043a\u0435 \u043e\u0441\u0442\u0430\u043b\u0441\u044f fetch");
  assert(!/useEffect/.test(code), "\u0431\u043b\u043e\u043a\u0438 \u0432\u0441\u0451 \u0435\u0449\u0451 \u0433\u0440\u0443\u0437\u044f\u0442\u0441\u044f \u0432 useEffect");
  assert(!/loading/.test(code), "\u043e\u0441\u0442\u0430\u043b\u0441\u044f \u0441\u043f\u0438\u043d\u043d\u0435\u0440 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438");
  assert(code.includes("bodyBlocks.map(renderBlock)"), "\u0431\u043b\u043e\u043a\u0438 \u043d\u0435 \u0440\u0438\u0441\u0443\u044e\u0442\u0441\u044f");
  assert(/<LegalFooter[^>]*siteOverrides=\{siteOverrides\}/.test(code), "\u043f\u043e\u0434\u0432\u0430\u043b \u043d\u0435 \u043f\u043e\u043b\u0443\u0447\u0430\u0435\u0442 \u0441\u0435\u0440\u0432\u0435\u0440\u043d\u044b\u0439 \u0442\u0435\u043a\u0441\u0442");
});

check("\u043f\u043e\u0434\u0432\u0430\u043b \u0432\u0438\u0434\u0435\u043d \u0431\u0435\u0437 \u0435\u0434\u0438\u043d\u043e\u0433\u043e \u0437\u0430\u043f\u0440\u043e\u0441\u0430 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435", () => {
  // Серверный рендер без всякого fetch: именно так страница приезжает пользователю.
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = () => {
    throw new Error("\u0432 SSR \u043d\u0435 \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u0437\u0430\u043f\u0440\u043e\u0441\u043e\u0432");
  };
  try {
    const html = renderToStaticMarkup(
      <LegalFooter siteOverrides={siteContent} blockOverrides={legalBlockOverrides(legalBlockData)} />,
    );
    const text = visibleText(html);
    assert(text.includes("\u041f\u0440\u0435\u0430\u043c\u0431\u0443\u043b\u0430, \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u043d\u0430\u044f \u0432 \u0440\u0430\u0437\u0434\u0435\u043b\u0435 \u041f\u0440\u0430\u0432\u043e\u0432\u0430\u044f \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u044f."), "\u0442\u0435\u043a\u0441\u0442 \u0430\u0434\u043c\u0438\u043d\u043a\u0438 \u043d\u0435 \u043f\u043e\u043f\u0430\u043b \u0432 SSR");
    assert(text.length > 4000, "\u043f\u043e\u0434\u0432\u0430\u043b \u043f\u043e\u0447\u0442\u0438 \u043f\u0443\u0441\u0442 \u0432 SSR");
  } finally {
    globalThis.fetch = originalFetch;
  }
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
