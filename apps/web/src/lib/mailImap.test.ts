import { describe, it, expect } from "vitest";
import { normalizeParsed, type ParsedLike } from "./mailNormalize";

function parsed(over: Partial<ParsedLike> = {}): ParsedLike {
  return {
    from: { text: "Клиент <client@example.com>", value: [], html: "" } as unknown as ParsedLike["from"],
    to: { text: "support@trioz.ru", value: [], html: "" } as unknown as ParsedLike["to"],
    subject: "Вопрос по оплате",
    text: "Здравствуйте, есть вопрос.",
    html: "<p>Здравствуйте</p>",
    messageId: "<abc@example.com>",
    date: new Date("2026-09-11T09:00:00Z"),
    ...over,
  } as ParsedLike;
}

describe("normalizeParsed", () => {
  it("маппит поля в строку базы", () => {
    const n = normalizeParsed(parsed(), "support@trioz.ru");
    expect(n.direction).toBe("incoming");
    expect(n.fromAddr).toBe("Клиент <client@example.com>");
    expect(n.toAddr).toBe("support@trioz.ru");
    expect(n.subject).toBe("Вопрос по оплате");
    expect(n.bodyHtml).toBe("<p>Здравствуйте</p>");
    expect(n.messageId).toBe("<abc@example.com>");
    expect(n.preview.length).toBeGreaterThan(0);
  });

  it("подставляет адрес ящика, если To пуст", () => {
    const n = normalizeParsed(parsed({ to: undefined }), "info@trioz.ru");
    expect(n.toAddr).toBe("info@trioz.ru");
  });

  it("(без темы) когда subject пуст", () => {
    const n = normalizeParsed(parsed({ subject: undefined }), "info@trioz.ru");
    expect(n.subject).toBe("(без темы)");
  });

  it("null для html когда его нет, и messageId null", () => {
    const n = normalizeParsed(parsed({ html: false, messageId: undefined }), "info@trioz.ru");
    expect(n.bodyHtml).toBeNull();
    expect(n.messageId).toBeNull();
  });

  it("подставляет текущую дату при неверной date", () => {
    const n = normalizeParsed(parsed({ date: undefined }), "info@trioz.ru");
    expect(n.sentAt instanceof Date).toBe(true);
    expect(isNaN(n.sentAt.getTime())).toBe(false);
  });
});
