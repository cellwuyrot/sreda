import { describe, it, expect } from "vitest";
import {
  PREMIUM_MESSAGE_WORDS,
  FREE_MESSAGE_WORDS,
  PREMIUM_MESSAGE_CHARS,
  FREE_MESSAGE_CHARS,
  PREMIUM_ENCRYPTED_CHARS,
  FREE_ENCRYPTED_CHARS,
  COLLAPSE_WORDS,
  COLLAPSE_CHARS,
  messageLimits,
  countWords,
  messageLengthError,
  isLongMessage,
} from "@/lib/messageLimits";

// ─── Константы ───────────────────────────────────────────────────────────────

describe("константы messageLimits", () => {
  it("PREMIUM_MESSAGE_WORDS = 4000", () => {
    expect(PREMIUM_MESSAGE_WORDS).toBe(4000);
  });

  it("FREE_MESSAGE_WORDS = 2000 (вдвое меньше premium)", () => {
    expect(FREE_MESSAGE_WORDS).toBe(2000);
  });

  it("FREE_MESSAGE_WORDS ровно в 2 раза меньше PREMIUM_MESSAGE_WORDS", () => {
    expect(FREE_MESSAGE_WORDS).toBe(PREMIUM_MESSAGE_WORDS / 2);
  });

  it("PREMIUM_MESSAGE_CHARS = 25000", () => {
    expect(PREMIUM_MESSAGE_CHARS).toBe(25_000);
  });

  it("FREE_MESSAGE_CHARS = 12500", () => {
    expect(FREE_MESSAGE_CHARS).toBe(12_500);
  });

  it("FREE_MESSAGE_CHARS ровно в 2 раза меньше PREMIUM_MESSAGE_CHARS", () => {
    expect(FREE_MESSAGE_CHARS).toBe(PREMIUM_MESSAGE_CHARS / 2);
  });

  it("PREMIUM_ENCRYPTED_CHARS = 40000", () => {
    expect(PREMIUM_ENCRYPTED_CHARS).toBe(40_000);
  });

  it("FREE_ENCRYPTED_CHARS = 20000", () => {
    expect(FREE_ENCRYPTED_CHARS).toBe(20_000);
  });

  it("FREE_ENCRYPTED_CHARS ровно в 2 раза меньше PREMIUM_ENCRYPTED_CHARS", () => {
    expect(FREE_ENCRYPTED_CHARS).toBe(PREMIUM_ENCRYPTED_CHARS / 2);
  });

  it("COLLAPSE_WORDS = 1200", () => {
    expect(COLLAPSE_WORDS).toBe(1200);
  });

  it("COLLAPSE_CHARS = 6000", () => {
    expect(COLLAPSE_CHARS).toBe(6000);
  });
});

// ─── messageLimits ───────────────────────────────────────────────────────────

describe("messageLimits", () => {
  it("premium: возвращает корректный набор лимитов", () => {
    expect(messageLimits(true)).toEqual({
      words: 4000,
      chars: 25_000,
      encryptedChars: 40_000,
    });
  });

  it("free: возвращает корректный набор лимитов", () => {
    expect(messageLimits(false)).toEqual({
      words: 2000,
      chars: 12_500,
      encryptedChars: 20_000,
    });
  });
});

// ─── countWords ──────────────────────────────────────────────────────────────

describe("countWords", () => {
  it("пустая строка → 0", () => {
    expect(countWords("")).toBe(0);
  });

  it("строка из пробелов → 0", () => {
    expect(countWords("   ")).toBe(0);
  });

  it("одно слово → 1", () => {
    expect(countWords("слово")).toBe(1);
  });

  it("три слова через пробел → 3", () => {
    expect(countWords("один два три")).toBe(3);
  });

  it("слова через несколько пробелов → считается правильно", () => {
    expect(countWords("один  два   три")).toBe(3);
  });

  it("слова через табуляцию и перевод строки → считается правильно", () => {
    expect(countWords("один\tдва\nтри")).toBe(3);
  });

  it("строка с ведущими и хвостовыми пробелами → считается без них", () => {
    expect(countWords("  один два  ")).toBe(2);
  });
});

// ─── messageLengthError ──────────────────────────────────────────────────────

describe("messageLengthError — free, не зашифровано", () => {
  it("пустая строка → null", () => {
    expect(messageLengthError("", { premium: false })).toBeNull();
  });

  it("ровно на лимите символов (12500) → null", () => {
    const text = "a".repeat(12_500);
    expect(messageLengthError(text, { premium: false })).toBeNull();
  });

  it("на один символ больше лимита (12501) → ошибка", () => {
    const text = "a".repeat(12_501);
    expect(messageLengthError(text, { premium: false })).not.toBeNull();
  });

  it("ровно на лимите слов (2000) → null", () => {
    const text = Array(2000).fill("слово").join(" ");
    expect(messageLengthError(text, { premium: false })).toBeNull();
  });

  it("на одно слово больше лимита (2001) → ошибка", () => {
    const text = Array(2001).fill("слово").join(" ");
    expect(messageLengthError(text, { premium: false })).not.toBeNull();
  });

  it("сообщение об ошибке по символам содержит '12 500'", () => {
    const text = "a".repeat(12_501);
    const error = messageLengthError(text, { premium: false });
    expect(error).toContain("12");
  });

  it("сообщение об ошибке для free содержит подсказку о Premium", () => {
    const text = "a".repeat(12_501);
    const error = messageLengthError(text, { premium: false });
    expect(error).toContain("Premium");
  });
});

describe("messageLengthError — premium, не зашифровано", () => {
  it("ровно на лимите символов (25000) → null", () => {
    const text = "a".repeat(25_000);
    expect(messageLengthError(text, { premium: true })).toBeNull();
  });

  it("на один символ больше лимита (25001) → ошибка", () => {
    const text = "a".repeat(25_001);
    expect(messageLengthError(text, { premium: true })).not.toBeNull();
  });

  it("ровно на лимите слов (4000) → null", () => {
    const text = Array(4000).fill("слово").join(" ");
    expect(messageLengthError(text, { premium: true })).toBeNull();
  });

  it("на одно слово больше лимита (4001) → ошибка", () => {
    const text = Array(4001).fill("слово").join(" ");
    expect(messageLengthError(text, { premium: true })).not.toBeNull();
  });

  it("сообщение об ошибке для premium НЕ содержит подсказку о Premium", () => {
    const text = "a".repeat(25_001);
    const error = messageLengthError(text, { premium: true });
    // hint добавляется только для free
    expect(error).not.toContain("С подпиской Premium");
  });
});

describe("messageLengthError — зашифровано (encrypted)", () => {
  it("free зашифрованный: ровно на лимите (20000) → null", () => {
    const text = "a".repeat(20_000);
    expect(messageLengthError(text, { premium: false, encrypted: true })).toBeNull();
  });

  it("free зашифрованный: на один символ больше (20001) → ошибка", () => {
    const text = "a".repeat(20_001);
    expect(messageLengthError(text, { premium: false, encrypted: true })).not.toBeNull();
  });

  it("premium зашифрованный: ровно на лимите (40000) → null", () => {
    const text = "a".repeat(40_000);
    expect(messageLengthError(text, { premium: true, encrypted: true })).toBeNull();
  });

  it("premium зашифрованный: на один символ больше (40001) → ошибка", () => {
    const text = "a".repeat(40_001);
    expect(messageLengthError(text, { premium: true, encrypted: true })).not.toBeNull();
  });

  it("зашифрованный текст: слова не считаются (только символы)", () => {
    // 2001 слово, но укладывается в лимит по символам — ошибки быть не должно
    const text = Array(2001).fill("а").join(" ");
    // длина: 2001 + 2000 пробелов = 4001 символ, что меньше free encrypted limit (20000)
    expect(messageLengthError(text, { premium: false, encrypted: true })).toBeNull();
  });
});

describe("messageLengthError — граничный и странный ввод", () => {
  it("options не переданы (по умолчанию free) — короткое сообщение → null", () => {
    expect(messageLengthError("привет")).toBeNull();
  });

  it("premium=false явно — то же самое что по умолчанию", () => {
    const text = "a".repeat(12_500);
    expect(messageLengthError(text, { premium: false })).toBeNull();
    expect(messageLengthError(text)).toBeNull();
  });
});

// ─── isLongMessage ───────────────────────────────────────────────────────────

describe("isLongMessage", () => {
  it("короткое сообщение → false", () => {
    expect(isLongMessage("привет")).toBe(false);
  });

  it("ровно COLLAPSE_CHARS (6000 символов) → false", () => {
    expect(isLongMessage("a".repeat(6000))).toBe(false);
  });

  it("COLLAPSE_CHARS + 1 (6001 символ) → true", () => {
    expect(isLongMessage("a".repeat(6001))).toBe(true);
  });

  it("ровно COLLAPSE_WORDS (1200 слов) → false", () => {
    // Используем однобуквенные слова: 1200*1 + 1199 пробелов = 2399 символов < COLLAPSE_CHARS(6000)
    const text = Array(1200).fill("а").join(" ");
    expect(isLongMessage(text)).toBe(false);
  });

  it("COLLAPSE_WORDS + 1 (1201 слово) → true", () => {
    // Используем однобуквенные слова: длина < COLLAPSE_CHARS, но слов > 1200
    const text = Array(1201).fill("а").join(" ");
    expect(isLongMessage(text)).toBe(true);
  });

  it("пустая строка → false", () => {
    expect(isLongMessage("")).toBe(false);
  });
});
