import { describe, expect, it } from "vitest";
import { BLOCK_TYPES } from "@/lib/aboutBlocks";
import {
  LEGAL_DEFAULTS,
  LEGAL_SECTIONS,
  legalKeys,
  resolveLegalContent,
} from "@/lib/legal";

describe("/about legal section", () => {
  it("не является AboutBlock и имеет полный текст по умолчанию", () => {
    expect(BLOCK_TYPES).not.toContain("legal" as never);

    const content = resolveLegalContent();
    expect(content.heading).toBe(LEGAL_DEFAULTS.heading);
    expect(content.subheading).toBe(LEGAL_DEFAULTS.subheading);
    expect(content.preamble.trim()).not.toBe("");
    expect(content.sections).toHaveLength(LEGAL_SECTIONS.length);
    expect(content.sections.every((section) => section.title && section.content)).toBe(true);
    expect(content.contactEmail).toContain("@");
    expect(content.contactUrl).toBe("https://trioz.ru");
  });

  it("подхватывает изменения из админ-панели", () => {
    const content = resolveLegalContent({
      [legalKeys.heading]: "Актуальное соглашение TRIOZ",
      [legalKeys.preamble]: "Преамбула из админ-панели.",
      [legalKeys.sectionTitle(0)]: "1. Обновлённые термины",
      [legalKeys.sectionContent(0)]: "Новый текст раздела.",
      [legalKeys.contactEmail]: "new-legal@trioz.ru",
    });

    expect(content.heading).toBe("Актуальное соглашение TRIOZ");
    expect(content.preamble).toBe("Преамбула из админ-панели.");
    expect(content.sections[0].title).toBe("1. Обновлённые термины");
    expect(content.sections[0].content).toBe("Новый текст раздела.");
    expect(content.contactEmail).toBe("new-legal@trioz.ru");
  });

  it("пустые значения не скрывают правовой текст", () => {
    const content = resolveLegalContent({
      [legalKeys.heading]: "   ",
      [legalKeys.preamble]: "\n",
      [legalKeys.sectionContent(0)]: "  ",
    });

    expect(content.heading).toBe(LEGAL_DEFAULTS.heading);
    expect(content.preamble).toBe(LEGAL_DEFAULTS.preamble);
    expect(content.sections[0].content).toBe(LEGAL_SECTIONS[0].content);
  });
});
