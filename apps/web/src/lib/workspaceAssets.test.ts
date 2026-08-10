/**
 * Тесты: src/lib/workspaceAssets.ts — вложения рабочей среды.
 *
 * Зачем правка. Картинки и PDF хранились строкой `data:` внутри состояния
 * среды, а состояние целиком лежит одной строкой в базе с пределом 2 МБ. Одна
 * фотография с телефона в таком виде занимает около двух мегабайт — то есть
 * переполняет среду целиком, и дальше не сохраняется НИЧЕГО, включая заметки и
 * задачи.
 *
 * Здесь проверяется разбор и отбор: что уезжает в хранилище, что остаётся на
 * месте и что отвергается. Ошибки тут стоят дорого в обе стороны — пропустить
 * лишнее значит сложить в хранилище мусор, не пропустить нужное значит оставить
 * среду переполненной.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_ASSET_BYTES,
  base64Bytes,
  cardsToLift,
  hasInlineAsset,
  isDataUrl,
  isStoredAssetUrl,
  parseDataUrl,
  stateBytes,
  withAssetUrl,
} from "@/lib/workspaceAssets";

/** Однопиксельный PNG — настоящий, а не выдуманная строка. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

describe("разбор data-строки", () => {
  it("узнаёт data-строку и уже загруженный адрес", () => {
    expect(isDataUrl(PNG_DATA_URL)).toBe(true);
    expect(isDataUrl("/uploads/workspace/a.png")).toBe(false);
    expect(isStoredAssetUrl("/uploads/workspace/a.png")).toBe(true);
    expect(isStoredAssetUrl(PNG_DATA_URL)).toBe(false);
  });

  it("разбирает настоящую картинку", () => {
    const parsed = parseDataUrl(PNG_DATA_URL);
    expect(parsed?.mime).toBe("image/png");
    expect(parsed?.ext).toBe("png");
    expect(parsed?.bytes).toBeGreaterThan(0);
  });

  it("размер считается формулой, а не раскодированием", () => {
    /* Строка бывает в десяток мегабайт: делать её вторую копию только ради
       длины — расточительно. Проверяем на известных значениях. */
    expect(base64Bytes("")).toBe(0);
    expect(base64Bytes("QQ==")).toBe(1); // "A"
    expect(base64Bytes("QUI=")).toBe(2); // "AB"
    expect(base64Bytes("QUJD")).toBe(3); // "ABC"
  });

  it("ФИКСАЦИЯ: неизвестный тип не принимается — в хранилище только разрешённое", () => {
    expect(parseDataUrl("data:application/x-msdownload;base64,QQ==")).toBeNull();
    expect(parseDataUrl("data:text/html;base64,QQ==")).toBeNull();
  });

  it("ФИКСАЦИЯ: слишком большой файл отвергается", () => {
    /* Отказ означает «оставить как есть», а не ошибку: карточка продолжит
       работать со своей строкой, просто состояние останется тяжёлым. */
    const huge = `data:image/png;base64,${"A".repeat(MAX_ASSET_BYTES * 2)}`;
    expect(parseDataUrl(huge)).toBeNull();
  });

  it("мусор вместо строки не роняет разбор", () => {
    for (const bad of ["", "data:", "data:image/png", "не строка вовсе", null, undefined, 42]) {
      expect(parseDataUrl(bad as unknown)).toBeNull();
    }
  });
});

describe("какие карточки переезжают", () => {
  it("картинка и рисунок — да", () => {
    expect(hasInlineAsset({ id: "1", type: "image", src: PNG_DATA_URL })).toBe(true);
    expect(hasInlineAsset({ id: "2", type: "drawing", src: PNG_DATA_URL })).toBe(true);
  });

  it("ФИКСАЦИЯ: документ переезжает только когда это PDF", () => {
    /* Текстовый документ живёт прямо в карточке, и это правильно: несколько
       килобайт текста в хранилище файлов — лишняя сущность на ровном месте. */
    expect(hasInlineAsset({ id: "3", type: "document", docKind: "pdf", src: "data:application/pdf;base64,QQ==" })).toBe(true);
    expect(hasInlineAsset({ id: "4", type: "document", docKind: "text", src: PNG_DATA_URL })).toBe(false);
  });

  it("уже переехавшая карточка второй раз не поедет", () => {
    expect(hasInlineAsset({ id: "5", type: "image", src: "/uploads/workspace/a.png" })).toBe(false);
  });

  it("карточки без вложений не трогаем", () => {
    for (const type of ["task", "note", "link", "table"]) {
      expect(hasInlineAsset({ id: "6", type, src: PNG_DATA_URL })).toBe(false);
    }
  });

  it("отбор возвращает только нуждающиеся в переезде", () => {
    const cards = [
      { id: "a", type: "image", src: PNG_DATA_URL },
      { id: "b", type: "image", src: "/uploads/workspace/b.png" },
      { id: "c", type: "note" },
      { id: "d", type: "document", docKind: "pdf", src: "data:application/pdf;base64,QQ==" },
    ];
    expect(cardsToLift(cards).map((c) => c.id)).toEqual(["a", "d"]);
  });
});

describe("подстановка адреса", () => {
  it("ИНВАРИАНТ: возвращается новая карточка, исходная не меняется", () => {
    /* Карточки на холсте неизменяемы: правка на месте сломала бы сравнение при
       отрисовке и историю отмены. */
    const card = { id: "a", type: "image", src: PNG_DATA_URL };
    const next = withAssetUrl(card, "/uploads/workspace/a.png");
    expect(next.src).toBe("/uploads/workspace/a.png");
    expect(card.src).toBe(PNG_DATA_URL);
    expect(next).not.toBe(card);
  });

  it("остальные поля карточки сохраняются", () => {
    const card = { id: "a", type: "image", src: PNG_DATA_URL, title: "Схема" } as const;
    expect(withAssetUrl(card, "/uploads/workspace/a.png").title).toBe("Схема");
  });
});

describe("вес состояния", () => {
  it("считается в байтах, а не в символах", () => {
    /* Кириллица в UTF-8 — два байта на букву. Предел на сервере в байтах, и
       считать длину строки значило бы обещать вдвое больше места, чем есть. */
    expect(stateBytes("abc")).toBe(3);
    expect(stateBytes("абв")).toBe(6);
  });
});
