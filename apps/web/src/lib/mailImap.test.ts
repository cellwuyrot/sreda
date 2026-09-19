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

  it("null для html когда его нет", () => {
    const n = normalizeParsed(parsed({ html: false }), "info@trioz.ru");
    expect(n.bodyHtml).toBeNull();
  });

  it("без Message-ID считает синтетический ключ дедупликации", () => {
    // Раньше здесь был null, и дедуп в опросе IMAP отключался: одно и то же
    // письмо пересоздавалось при каждой проверке почты.
    const a = normalizeParsed(parsed({ messageId: undefined }), "info@trioz.ru");
    expect(a.messageId).toMatch(/^synthetic:[0-9a-f]{64}$/);

    // Ключ устойчив: те же поля — тот же ключ.
    const b = normalizeParsed(parsed({ messageId: undefined }), "info@trioz.ru");
    expect(b.messageId).toBe(a.messageId);
  });

  it("синтетический ключ различает письма и ящики", () => {
    const base = normalizeParsed(parsed({ messageId: undefined }), "info@trioz.ru");
    const otherSubject = normalizeParsed(parsed({ messageId: undefined, subject: "Другая тема" }), "info@trioz.ru");
    const otherBox = normalizeParsed(parsed({ messageId: undefined, to: undefined }), "sales@trioz.ru");
    expect(otherSubject.messageId).not.toBe(base.messageId);
    expect(otherBox.messageId).not.toBe(base.messageId);
  });

  it("подставляет текущую дату при неверной date", () => {
    const n = normalizeParsed(parsed({ date: undefined }), "info@trioz.ru");
    expect(n.sentAt instanceof Date).toBe(true);
    expect(isNaN(n.sentAt.getTime())).toBe(false);
  });
});
