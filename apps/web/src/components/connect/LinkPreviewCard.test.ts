import { describe, it, expect } from "vitest";
import { firstLink } from "./LinkPreviewCard";

describe("firstLink", () => {
  it("возвращает null, если ссылок нет", () => {
    expect(firstLink("Привет, как дела?")).toBeNull();
  });

  it("находит http-ссылку", () => {
    expect(firstLink("Смотри http://example.com")).toBe("http://example.com");
  });

  it("находит https-ссылку", () => {
    expect(firstLink("Открой https://trioz.app/chat")).toBe("https://trioz.app/chat");
  });

  it("обрезает хвостовую пунктуацию из ссылки", () => {
    expect(firstLink("Ссылка: https://example.com.")).toBe("https://example.com");
  });

  it("обрезает хвостовую запятую", () => {
    expect(firstLink("https://example.com, и ещё текст")).toBe("https://example.com");
  });

  it("возвращает только первую ссылку, если их несколько", () => {
    const result = firstLink("https://first.com и https://second.com");
    expect(result).toBe("https://first.com");
  });

  it("сохраняет query string ссылки", () => {
    expect(firstLink("https://example.com/search?q=hello&page=1")).toBe("https://example.com/search?q=hello&page=1");
  });

  it("возвращает null для строки без протокола (www. без https)", () => {
    // firstLink ищет только http:// и https://, не www.
    expect(firstLink("www.example.com")).toBeNull();
  });

  it("не обрезает закрывающую скобку внутри ссылки (markdown-стиль)", () => {
    // Хвостовые скобки в конце обрезаются, но не внутри
    const result = firstLink("https://en.wikipedia.org/wiki/Test)");
    expect(result).toBe("https://en.wikipedia.org/wiki/Test");
  });
});
