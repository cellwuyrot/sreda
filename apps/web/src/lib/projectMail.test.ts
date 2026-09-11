import { describe, it, expect } from "vitest";
import {
  PROJECT_MAILBOXES,
  MAIL_DOMAIN,
  mailboxAddress,
  findMailbox,
  isMailDirection,
  previewFromText,
  buildEml,
  emlFileName,
} from "./projectMail";

describe("PROJECT_MAILBOXES — целостность списка", () => {
  it("содержит ровно 9 ящиков из брифа", () => {
    expect(PROJECT_MAILBOXES).toHaveLength(9);
  });

  it("все localPart уникальны", () => {
    const set = new Set(PROJECT_MAILBOXES.map((m) => m.localPart));
    expect(set.size).toBe(PROJECT_MAILBOXES.length);
  });

  it("содержит именно ожидаемые адреса", () => {
    const expected = ["info", "sales", "support", "legal", "docs", "partners", "hr", "media", "security"];
    expect(PROJECT_MAILBOXES.map((m) => m.localPart)).toEqual(expected);
  });

  it("order идёт подряд 0..8", () => {
    expect(PROJECT_MAILBOXES.map((m) => m.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("все полные адреса на домене trioz.ru", () => {
    for (const m of PROJECT_MAILBOXES) {
      expect(mailboxAddress(m.localPart)).toBe(`${m.localPart}@${MAIL_DOMAIN}`);
      expect(mailboxAddress(m.localPart).endsWith("@trioz.ru")).toBe(true);
    }
  });
});

describe("findMailbox", () => {
  it("находит ящик без учёта регистра и пробелов", () => {
    expect(findMailbox("INFO")?.localPart).toBe("info");
    expect(findMailbox("  sales ")?.localPart).toBe("sales");
  });

  it("возвращает undefined для неизвестного", () => {
    expect(findMailbox("ceo")).toBeUndefined();
  });
});

describe("isMailDirection", () => {
  it("принимает только incoming/outgoing", () => {
    expect(isMailDirection("incoming")).toBe(true);
    expect(isMailDirection("outgoing")).toBe(true);
    expect(isMailDirection("draft")).toBe(false);
    expect(isMailDirection(null)).toBe(false);
  });
});

describe("previewFromText", () => {
  it("схлопывает пробелы и переносы", () => {
    expect(previewFromText("  Привет\n\n  мир  ")).toBe("Привет мир");
  });

  it("режет длинный текст и добавляет многоточие", () => {
    const out = previewFromText("a".repeat(200), 20);
    expect(out.length).toBe(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("короткий текст не трогает", () => {
    expect(previewFromText("Коротко", 160)).toBe("Коротко");
  });
});

describe("buildEml", () => {
  const base = {
    fromAddr: "client@example.com",
    toAddr: "support@trioz.ru",
    subject: "Проблема с входом",
    sentAt: new Date("2026-09-11T12:00:00Z"),
    bodyText: "Здравствуйте, не могу войти.",
  };

  it("содержит обязательные заголовки", () => {
    const eml = buildEml(base);
    expect(eml).toContain("MIME-Version: 1.0");
    expect(eml).toContain("From: client@example.com");
    expect(eml).toContain("To: support@trioz.ru");
    expect(eml).toContain("Date: ");
  });

  it("кодирует кириллическую тему в RFC 2047", () => {
    const eml = buildEml(base);
    expect(eml).toContain("Subject: =?UTF-8?B?");
    // тема не должна утечь сырым текстом в заголовке
    expect(eml).not.toContain("Subject: Проблема");
  });

  it("тело кодируется base64 и декодируется обратно", () => {
    const eml = buildEml(base);
    expect(eml).toContain("Content-Transfer-Encoding: base64");
    const b64 = Buffer.from(base.bodyText, "utf8").toString("base64");
    expect(eml).toContain(b64);
  });

  it("при наличии HTML собирает multipart/alternative", () => {
    const eml = buildEml({ ...base, bodyHtml: "<p>Привет</p>" });
    expect(eml).toContain("multipart/alternative");
    expect(eml).toContain("text/html");
    expect(eml).toContain("text/plain");
  });

  it("добавляет Message-ID в угловых скобках без двойных <>", () => {
    const eml = buildEml({ ...base, messageId: "<abc-123@trioz.ru>" });
    expect(eml).toContain("Message-ID: <abc-123@trioz.ru>");
    expect(eml).not.toContain("<<");
  });
});

describe("emlFileName", () => {
  it("безопасное имя .eml", () => {
    expect(emlFileName("clx123")).toBe("trioz-mail-clx123.eml");
  });
});
