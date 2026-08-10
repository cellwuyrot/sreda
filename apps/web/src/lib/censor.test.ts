/**
 * Тесты: lib/censor.ts — чистая логика без базы.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeForCensor,
  matchCensorWords,
  strictestLevel,
  normalizeCensorWordInput,
  CENSOR_WORD_MIN,
  CENSOR_WORD_MAX,
  type CensorEntry,
} from "@/lib/censor";

// ─────────────────────────────────────────────────────────────
// normalizeForCensor
// ─────────────────────────────────────────────────────────────
describe("normalizeForCensor", () => {
  it("приводит к нижнему регистру", () => {
    expect(normalizeForCensor("ДУРАК")).toBe("дурак");
  });

  // ОШИБКА В ИСТОЧНИКЕ: normalize("NFKD") разбивает «ё» на «е» + combining diaeresis (U+0308).
  // Затем replace(/ё/g) ищет готовый символ U+0451, которого уже нет — combining знак остаётся.
  // В итоге normalizeForCensor("ёж") возвращает "ёж" вместо "еж".
  it("заменяет ё на е [SKIP: ошибка — NFKD разбивает ё до замены, combining diaeresis остаётся]", () => {
    expect(normalizeForCensor("ёж")).toBe("еж");
    expect(normalizeForCensor("Ёлка")).toBe("елка");
  });

  it("латинская a → кириллическая а", () => {
    expect(normalizeForCensor("a")).toBe("а");
  });

  it("все латинские двойники: a c e o p x y k m t h b → кириллица", () => {
    // проверяем каждый символ по отдельности
    const cases: [string, string][] = [
      ["a", "а"],
      ["c", "с"],
      ["e", "е"],
      ["o", "о"],
      ["p", "р"],
      ["x", "х"],
      ["y", "у"],
      ["k", "к"],
      ["m", "м"],
      ["t", "т"],
      ["h", "н"],
      ["b", "ь"],
    ];
    for (const [latin, cyrillic] of cases) {
      expect(normalizeForCensor(latin)).toBe(cyrillic);
    }
  });

  it("цифры-двойники: 0→о, 3→з, 4→ч, 6→б", () => {
    expect(normalizeForCensor("0")).toBe("о");
    expect(normalizeForCensor("3")).toBe("з");
    expect(normalizeForCensor("4")).toBe("ч");
    expect(normalizeForCensor("6")).toBe("б");
  });

  it("растянутые буквы схлопываются", () => {
    expect(normalizeForCensor("дуррррак")).toBe("дурак");
    expect(normalizeForCensor("сууука")).toBe("сука");
    expect(normalizeForCensor("аааа")).toBe("а");
  });

  it("невидимый знак (zero-width space U+200B) выбрасывается", () => {
    // U+200B — zero width space, входит в диапазон INVISIBLE
    const withInvisible = "д​урак";
    expect(normalizeForCensor(withInvisible)).toBe("дурак");
  });

  it("слово без изменений остаётся без изменений (только нижний регистр)", () => {
    expect(normalizeForCensor("привет")).toBe("привет");
  });
});

// ─────────────────────────────────────────────────────────────
// strictestLevel
// ─────────────────────────────────────────────────────────────
describe("strictestLevel", () => {
  it("пустой список → null", () => {
    expect(strictestLevel([])).toBeNull();
  });

  it("BLOCK строже WARN и WATCH", () => {
    expect(strictestLevel(["WARN", "WATCH", "BLOCK"])).toBe("BLOCK");
  });

  it("WARN строже WATCH", () => {
    expect(strictestLevel(["WATCH", "WARN"])).toBe("WARN");
  });

  it("единственный уровень возвращается как есть", () => {
    expect(strictestLevel(["WATCH"])).toBe("WATCH");
    expect(strictestLevel(["WARN"])).toBe("WARN");
    expect(strictestLevel(["BLOCK"])).toBe("BLOCK");
  });

  it("дублирующиеся уровни не мешают выбрать правильный", () => {
    expect(strictestLevel(["WATCH", "WATCH", "WARN", "WARN"])).toBe("WARN");
  });
});

// ─────────────────────────────────────────────────────────────
// matchCensorWords
// ─────────────────────────────────────────────────────────────
describe("matchCensorWords", () => {
  it("пустой словарь → level: null без обработки", () => {
    const result = matchCensorWords("дурак", []);
    expect(result.level).toBeNull();
    expect(result.matches).toHaveLength(0);
  });

  it("пустой текст → level: null", () => {
    const dict: CensorEntry[] = [{ word: "дурак", level: "BLOCK" }];
    const result = matchCensorWords("", dict);
    expect(result.level).toBeNull();
    expect(result.matches).toHaveLength(0);
  });

  it("находит слово в другом регистре", () => {
    const dict: CensorEntry[] = [{ word: "дурак", level: "WARN" }];
    const result = matchCensorWords("ДУРАК!", dict);
    expect(result.level).toBe("WARN");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].word).toBe("дурак");
  });

  it("находит слово при латинской подмене буквы (c → с в слове «скот»)", () => {
    // Латинская «c» (U+0063) неотличима от кириллической «с» (U+0441) начертанием.
    // normalizeForCensor заменяет латинскую c → с, поэтому «cкот» (лат. c) ловится.
    const dict: CensorEntry[] = [{ word: "скот", level: "BLOCK" }];
    const result = matchCensorWords("cкот", dict); // первая буква — латинская c
    expect(result.level).toBe("BLOCK");
  });

  it("находит растянутое слово («дуррррак»)", () => {
    const dict: CensorEntry[] = [{ word: "дурак", level: "WARN" }];
    const result = matchCensorWords("дуррррак", dict);
    expect(result.level).toBe("WARN");
  });

  it("находит слово, разорванное точками («д.у.р.а.к»)", () => {
    const dict: CensorEntry[] = [{ word: "дурак", level: "BLOCK" }];
    const result = matchCensorWords("д.у.р.а.к", dict);
    expect(result.level).toBe("BLOCK");
  });

  it("находит слово, разорванное пробелами («д у р а к»)", () => {
    const dict: CensorEntry[] = [{ word: "дурак", level: "BLOCK" }];
    const result = matchCensorWords("д у р а к", dict);
    expect(result.level).toBe("BLOCK");
  });

  it("не находит слово, которого нет в тексте", () => {
    const dict: CensorEntry[] = [{ word: "дурак", level: "BLOCK" }];
    const result = matchCensorWords("добрый день", dict);
    expect(result.level).toBeNull();
    expect(result.matches).toHaveLength(0);
  });

  it("подстрочное совпадение: «дур» ловится внутри «дураками»", () => {
    // Заявленное поведение: сопоставление идёт по подстроке, формы не нужны
    const dict: CensorEntry[] = [{ word: "дур", level: "WATCH" }];
    const result = matchCensorWords("Привет дураками", dict);
    expect(result.level).toBe("WATCH");
    expect(result.matches).toHaveLength(1);
  });

  it("ИЗВЕСТНОЕ ЛОЖНОЕ СРАБАТЫВАНИЕ: «хер» → «Херсон»", () => {
    // Сопоставление по подстроке — намеренная архитектурная черта,
    // задокументированная в комментарии к censor.ts.
    // Тест фиксирует поведение «как есть», а не скрывает его.
    const dict: CensorEntry[] = [{ word: "хер", level: "WATCH" }];
    const result = matchCensorWords("Херсон — город на Украине", dict);
    // «хер» содержится в «Херсон» после нормализации → ложное срабатывание
    expect(result.level).toBe("WATCH");
    expect(result.matches).toHaveLength(1);
  });

  it("дубли в словаре разными регистрами дают только одно совпадение", () => {
    const dict: CensorEntry[] = [
      { word: "Дурак", level: "WARN" },
      { word: "дурак", level: "BLOCK" },
    ];
    const result = matchCensorWords("дурак", dict);
    // seen-дедупликация по нормализованному needle
    expect(result.matches).toHaveLength(1);
  });

  it("возвращает строжайший уровень из нескольких совпавших", () => {
    const dict: CensorEntry[] = [
      { word: "дур", level: "WATCH" },
      { word: "хам", level: "BLOCK" },
    ];
    const result = matchCensorWords("дурной хам", dict);
    expect(result.level).toBe("BLOCK");
    expect(result.matches).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────
// normalizeCensorWordInput
// ─────────────────────────────────────────────────────────────
describe("normalizeCensorWordInput", () => {
  it("обрезает пробелы и приводит к нижнему регистру", () => {
    const result = normalizeCensorWordInput("  Дурак  ");
    expect("word" in result && result.word).toBe("дурак");
  });

  it("отказывает, если аргумент не строка (число)", () => {
    const result = normalizeCensorWordInput(42);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/строк/i);
  });

  it("отказывает, если аргумент не строка (null)", () => {
    const result = normalizeCensorWordInput(null);
    expect("error" in result).toBe(true);
  });

  it(`отказывает на слове короче ${CENSOR_WORD_MIN} символов`, () => {
    const result = normalizeCensorWordInput("а");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/короч/i);
  });

  it(`отказывает на слове длиннее ${CENSOR_WORD_MAX} символов`, () => {
    const long = "а".repeat(CENSOR_WORD_MAX + 1);
    const result = normalizeCensorWordInput(long);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/длинн/i);
  });

  it("отказывает на записи из одних разделителей (поймала бы любой текст)", () => {
    const result = normalizeCensorWordInput("...");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/букв/i);
  });

  it("принимает минимально допустимое слово (ровно 2 символа)", () => {
    const result = normalizeCensorWordInput("ок");
    expect("word" in result).toBe(true);
  });

  it("принимает слово ровно в ${CENSOR_WORD_MAX} символов", () => {
    const max = "а".repeat(CENSOR_WORD_MAX);
    const result = normalizeCensorWordInput(max);
    expect("word" in result).toBe(true);
  });

  it("пустая строка после trim → слишком коротко", () => {
    const result = normalizeCensorWordInput("   ");
    expect("error" in result).toBe(true);
  });
});
