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
});
