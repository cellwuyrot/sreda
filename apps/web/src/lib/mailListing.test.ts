/**
 * MAIL-HISTORY: тесты сборки параметров истории ящика.
 *
 * Это те самые правила, из-за которых экран вёл себя странно: поиск не
 * доходил до базы, папка фильтровала только видимые строки, а архив
 * смешивал входящие с исходящими. Поэтому проверяем не «работает ли
 * URLSearchParams», а решения: какое направление победит, что уедет на
 * сервер и что будет с границами окна выборки.
 */
import { describe, it, expect } from "vitest";
import { listingParams, type MailListQuery } from "./mailListing";

function params(over: Partial<MailListQuery> = {}): URLSearchParams {
  return new URLSearchParams(
    listingParams({
      tab: "incoming",
      archiveDir: "",
      query: "",
      folder: null,
      offset: 0,
      limit: 25,
      ...over,
    }),
  );
}

describe("listingParams — направление", () => {
  it("вкладка задаёт направление", () => {
    expect(params({ tab: "incoming" }).get("direction")).toBe("incoming");
    expect(params({ tab: "outgoing" }).get("direction")).toBe("outgoing");
  });

  it("архив без выбранного направления не фильтрует по нему", () => {
    const p = params({ tab: "archive" });
    expect(p.get("archived")).toBe("1");
    expect(p.get("direction")).toBeNull();
  });

  it("архив с выбранным направлением отдаёт раздельную историю", () => {
    const p = params({ tab: "archive", archiveDir: "outgoing" });
    expect(p.get("archived")).toBe("1");
    expect(p.get("direction")).toBe("outgoing");
  });

  it("активные письма не помечаются как архив", () => {
    expect(params({ tab: "incoming" }).get("archived")).toBeNull();
  });

  it("корзина использует отдельный серверный фильтр", () => {
    const p = params({ tab: "trash" });
    expect(p.get("trashed")).toBe("1");
    expect(p.get("archived")).toBeNull();
  });
});

describe("listingParams — поиск", () => {
  it("непустой поиск уходит на сервер", () => {
    expect(params({ query: "оплата" }).get("q")).toBe("оплата");
  });

  it("пустой и пробельный поиск не добавляет параметр", () => {
    expect(params({ query: "" }).get("q")).toBeNull();
    expect(params({ query: "   " }).get("q")).toBeNull();
  });

  it("пробелы по краям срезаются", () => {
    expect(params({ query: "  счёт  " }).get("q")).toBe("счёт");
  });
});

describe("listingParams — фильтр папки", () => {
  const folder = { fromContains: "support@", toContains: "info@", subjectContains: "счёт" };

  it("условия папки уезжают в базу", () => {
    const p = params({ folder });
    expect(p.get("from")).toBe("support@");
    expect(p.get("to")).toBe("info@");
    expect(p.get("subject")).toBe("счёт");
  });

  it("ИНВАРИАНТ: направление вкладки главнее направления папки", () => {
    // Иначе папка «исходящие» на вкладке «Входящие» давала бы пустой список.
    const p = params({ tab: "incoming", folder: { ...folder, direction: "outgoing" } });
    expect(p.get("direction")).toBe("incoming");
  });

  it("в архиве «Все» направление берётся из папки", () => {
    const p = params({ tab: "archive", archiveDir: "", folder: { direction: "outgoing" } });
    expect(p.get("direction")).toBe("outgoing");
  });

  it("выбранное в архиве направление главнее папки", () => {
    const p = params({ tab: "archive", archiveDir: "incoming", folder: { direction: "outgoing" } });
    expect(p.get("direction")).toBe("incoming");
  });

  it("мусорное направление папки игнорируется", () => {
    const p = params({ tab: "archive", folder: { direction: "куда-нибудь" } });
    expect(p.get("direction")).toBeNull();
  });

  it("пустые поля папки не превращаются в пустые фильтры", () => {
    const p = params({ folder: { fromContains: "", toContains: "", subjectContains: "" } });
    expect(p.get("from")).toBeNull();
    expect(p.get("to")).toBeNull();
    expect(p.get("subject")).toBeNull();
  });
});

describe("listingParams — окно выборки", () => {
  it("смещение и лимит передаются как есть", () => {
    const p = params({ offset: 50, limit: 25 });
    expect(p.get("offset")).toBe("50");
    expect(p.get("limit")).toBe("25");
  });

  it("отрицательное смещение и нулевой лимит приводятся к допустимым", () => {
    const p = params({ offset: -10, limit: 0 });
    expect(p.get("offset")).toBe("0");
    expect(p.get("limit")).toBe("1");
  });

  it("дробные значения обрезаются до целых", () => {
    const p = params({ offset: 12.9, limit: 25.7 });
    expect(p.get("offset")).toBe("12");
    expect(p.get("limit")).toBe("25");
  });
});
