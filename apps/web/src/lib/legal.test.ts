/**
 * Тесты: сборка действующей редакции правовой информации.
 *
 * Зачем это под тестом. Текст соглашения раньше жил в двух хранилищах: блок
 * 'legal' в таблице AboutBlock (редактор «О проекте») и ключи `content:legal.*`
 * в siteConfig (раздел «Контент сайта → Правовая информация»). Страница /about
 * читала только первое из них — и большого текста из админки на сайте не было
 * видно вовсе, а без блока подвал оставался совсем без содержания.
 *
 * Отсюда то, что здесь закрепляется:
 *
 *   • без переопределений всегда есть полная редакция из кода — пустой
 *     страницы больше быть не может;
 *   • значение из админки перебивает текст по умолчанию;
 *   • пустое или пробельное значение возвращает текст по умолчанию,
 *     а не обнуляет раздел на сайте.
 */
import { describe, it, expect } from "vitest";
import {
  legacyLegalOverrides,
  mergeLegalOverrides,
  LEGAL_CONTACTS,
  LEGAL_DEFAULTS,
  LEGAL_SECTIONS,
  legalKeys,
  resolveLegalContent,
} from "@/lib/legal";

describe("resolveLegalContent", () => {
  it("ИНВАРИАНТ: без настроек возвращает полный текст из кода", () => {
    const content = resolveLegalContent();

    expect(content.heading).toBe(LEGAL_DEFAULTS.heading);
    expect(content.subheading).toBe(LEGAL_DEFAULTS.subheading);
    expect(content.preamble).toBe(LEGAL_DEFAULTS.preamble);
    expect(content.sections).toHaveLength(LEGAL_SECTIONS.length);
    expect(content.sections.length).toBeGreaterThan(0);

    // Каждый раздел должен иметь и заголовок, и текст.
    for (const section of content.sections) {
      expect(section.title.trim()).not.toBe("");
      expect(section.content.trim()).not.toBe("");
    }
  });

  it("null и пустой ответ API равнозначны редакции по умолчанию", () => {
    expect(resolveLegalContent(null)).toEqual(resolveLegalContent());
    expect(resolveLegalContent({})).toEqual(resolveLegalContent());
  });

  it("текст из админки перебивает шапку, оферту и разделы", () => {
    const content = resolveLegalContent({
      [legalKeys.heading]: "Оферта TRIOZ",
      [legalKeys.subheading]: "редакция от 1 января 2027 г.",
      [legalKeys.preamble]: "Собственная преамбула администратора.",
      [legalKeys.sectionTitle(0)]: "1. Свои термины",
      [legalKeys.sectionContent(0)]: "Своё определение платформы.",
    });

    expect(content.heading).toBe("Оферта TRIOZ");
    expect(content.subheading).toBe("редакция от 1 января 2027 г.");
    expect(content.preamble).toBe("Собственная преамбула администратора.");
    expect(content.sections[0]).toEqual({
      title: "1. Свои термины",
      content: "Своё определение платформы.",
    });

    // Нетронутые разделы остаются из кода.
    expect(content.sections[1].title).toBe(LEGAL_SECTIONS[1].title);
  });

  it("ИНВАРИАНТ: пустое поле в админке не стирает раздел на сайте", () => {
    const content = resolveLegalContent({
      [legalKeys.heading]: "",
      [legalKeys.subheading]: "   ",
      [legalKeys.sectionContent(0)]: "\n  \n",
    });

    expect(content.heading).toBe(LEGAL_DEFAULTS.heading);
    expect(content.subheading).toBe(LEGAL_DEFAULTS.subheading);
    expect(content.sections[0].content).toBe(LEGAL_SECTIONS[0].content);
  });

  it("контакты для юридических запросов всегда заполнены", () => {
    const content = resolveLegalContent();
    expect(content.contactEmail).toContain("@");
    expect(content.contactUrl).toMatch(/^https?:\/\//);
  });

  /* Почты. Раньше на сайте был один жёстко вбитый адрес без подписи:
     медийных и сервисных контактов не было вовсе, а правка требовала
     изменения кода. */
  it("ИНВАРИАНТ: каждый канал обращений имеет подпись и почту", () => {
    const content = resolveLegalContent();

    expect(content.contacts).toHaveLength(LEGAL_CONTACTS.length);
    expect(content.contacts.length).toBeGreaterThanOrEqual(2);

    for (const contact of content.contacts) {
      expect(contact.label.trim()).not.toBe("");
      expect(contact.hint.trim()).not.toBe("");
      expect(contact.email).toContain("@");
    }

    // На сайте обязательно есть и правовая, и медийная почта.
    const keys = content.contacts.map((c) => c.key);
    expect(keys).toContain("legal");
    expect(keys).toContain("media");

    // Почты не дублируются — иначе список теряет смысл.
    const emails = content.contacts.map((c) => c.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("почты и подписи из админки перебивают значения по умолчанию", () => {
    const content = resolveLegalContent({
      [legalKeys.contactEmail("legal")]: "pravo@trioz.ru",
      [legalKeys.contactLabel("media")]: "Пресс-служба",
      [legalKeys.contactEmail("media")]: "press@trioz.ru",
      [legalKeys.contactUrl]: "https://trioz.ru/about",
    });

    const byKey = Object.fromEntries(content.contacts.map((c) => [c.key, c]));

    expect(byKey.legal.email).toBe("pravo@trioz.ru");
    expect(byKey.media.label).toBe("Пресс-служба");
    expect(byKey.media.email).toBe("press@trioz.ru");
    expect(content.contactUrl).toBe("https://trioz.ru/about");

    // Почта юридического канала — та же, что в коротких ссылках подвала.
    expect(content.contactEmail).toBe("pravo@trioz.ru");

    // Нетронутые каналы остаются из кода.
    expect(byKey.support.email).toBe(
      LEGAL_CONTACTS.find((c) => c.key === "support")!.email,
    );
  });

  it("ИНВАРИАНТ: пустое поле почты не оставляет сайт без контакта", () => {
    const content = resolveLegalContent({
      [legalKeys.contactEmail("legal")]: "",
      [legalKeys.contactEmail("media")]: "   ",
      [legalKeys.contactLabel("support")]: "\n \n",
      [legalKeys.contactUrl]: "",
    });

    const byKey = Object.fromEntries(content.contacts.map((c) => [c.key, c]));
    const defaults = Object.fromEntries(LEGAL_CONTACTS.map((c) => [c.key, c]));

    expect(byKey.legal.email).toBe(defaults.legal.email);
    expect(byKey.media.email).toBe(defaults.media.email);
    expect(byKey.support.label).toBe(defaults.support.label);
    expect(content.contactUrl).toBe(LEGAL_DEFAULTS.contactUrl);
  });
});

/* Унаследованный блок «Правовая информация».

   Главная причина того, что текст не появлялся на /about: до переезда
   соглашение редактировалось как блок страницы и хранилось в таблице
   AboutBlock, а новый подвал читал только siteConfig. Заполненный
   администратором текст обязан показываться из любого из двух хранилищ. */
describe("унаследованный блок соглашения", () => {
  const legacyBlock = {
    heading: "Соглашение из старого блока",
    subheading: "редакция от 5 марта 2026 г.",
    contactEmail: "old-legal@trioz.ru",
    contactUrl: "https://trioz.ru/legal",
    sections: [
      { title: "1. Свои термины", content: "Текст первого раздела из блока." },
      { title: "2. Свой предмет", content: "Текст второго раздела из блока." },
    ],
  };

  it("ИНВАРИАНТ: текст из старого блока показывается на сайте", () => {
    const content = resolveLegalContent(
      mergeLegalOverrides(legacyLegalOverrides(legacyBlock), null),
    );

    expect(content.heading).toBe("Соглашение из старого блока");
    expect(content.subheading).toBe("редакция от 5 марта 2026 г.");
    expect(content.sections[0]).toEqual({
      title: "1. Свои термины",
      content: "Текст первого раздела из блока.",
    });
    expect(content.contactEmail).toBe("old-legal@trioz.ru");
    expect(content.contactUrl).toBe("https://trioz.ru/legal");

    // Разделы, которых в блоке не было, остаются из редакции кода.
    expect(content.sections.length).toBeGreaterThanOrEqual(LEGAL_SECTIONS.length);
  });

  it("новый раздел админки важнее старого блока", () => {
    const content = resolveLegalContent(
      mergeLegalOverrides(legacyLegalOverrides(legacyBlock), {
        [legalKeys.heading]: "Актуальное соглашение",
      }),
    );

    expect(content.heading).toBe("Актуальное соглашение");
    // Нетронутое берётся из блока, а не теряется.
    expect(content.subheading).toBe("редакция от 5 марта 2026 г.");
  });

  it("разделов может быть больше, чем в редакции по умолчанию", () => {
    const extraIndex = LEGAL_SECTIONS.length; // девятый раздел
    const content = resolveLegalContent({
      [legalKeys.sectionTitle(extraIndex)]: "9. Дополнительные условия",
      [legalKeys.sectionContent(extraIndex)]: "Текст добавленного раздела.",
    });

    expect(content.sections).toHaveLength(LEGAL_SECTIONS.length + 1);
    expect(content.sections[extraIndex]).toEqual({
      title: "9. Дополнительные условия",
      content: "Текст добавленного раздела.",
    });
  });

  it("мусорные данные блока не ломают страницу", () => {
    for (const junk of [null, undefined, 42, "текст", [], {}, { sections: "не массив" }]) {
      expect(legacyLegalOverrides(junk)).toEqual({});
    }

    const content = resolveLegalContent(mergeLegalOverrides(legacyLegalOverrides(null)));
    expect(content.heading).toBe(LEGAL_DEFAULTS.heading);
    expect(content.sections).toHaveLength(LEGAL_SECTIONS.length);
  });
});
