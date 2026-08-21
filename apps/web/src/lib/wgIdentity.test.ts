import { describe, expect, it } from "vitest";
import { parseStoredKeyPair, pickKeyPair, serializeKeyPair } from "@/lib/wgIdentity";

const PAIR = {
  privateKey: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd28=",
  publicKey: "d29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGU=",
};

const OTHER = {
  privateKey: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
  publicKey: "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjI=",
};

describe("parseStoredKeyPair", () => {
  it("читает свою же запись", () => {
    expect(parseStoredKeyPair(serializeKeyPair(PAIR))).toEqual(PAIR);
  });

  it("мусор, обрезки и половинчатые записи — это отсутствие ключа, а не ошибка", () => {
    expect(parseStoredKeyPair(null)).toBeNull();
    expect(parseStoredKeyPair("")).toBeNull();
    expect(parseStoredKeyPair("не json")).toBeNull();
    expect(parseStoredKeyPair("[]")).toBeNull();
    expect(parseStoredKeyPair(JSON.stringify({ privateKey: PAIR.privateKey }))).toBeNull();
    expect(parseStoredKeyPair(JSON.stringify({ privateKey: "коротко", publicKey: PAIR.publicKey }))).toBeNull();
  });

  /*
   * Важно именно для обоих ключей: если проверять только приватный, битый
   * публичный уедет на узел и тот просто не будет отвечать — без любой ошибки.
   */
  it("битый публичный ключ тоже отбрасывается", () => {
    expect(parseStoredKeyPair(JSON.stringify({ privateKey: PAIR.privateKey, publicKey: "???" }))).toBeNull();
  });
});

describe("pickKeyPair", () => {
  /**
   * ГЛАВНЫЙ ИНВАРИАНТ (FIX-KEYSTICK): если ключ устройства уже есть, новый НЕ
   * создаётся. Именно из-за обратного поведения VPN и не работал: каждое
   * включение выдавало новую пару, узел заменял пира (в журнале «+1 / -1») и молча
   * выкидывал пакеты старого ключа: туннель «поднят», 180 байт принято,
   * полезного трафика ноль.
   */
  it("существующий ключ переиспользуется и новый не создаётся", () => {
    let calls = 0;
    const create = () => {
      calls += 1;
      return OTHER;
    };
    const result = pickKeyPair(serializeKeyPair(PAIR), create);
    expect(result.pair).toEqual(PAIR);
    expect(result.created).toBe(false);
    expect(calls).toBe(0);
  });

  it("пустое хранилище — ключ создаётся один раз", () => {
    let calls = 0;
    const create = () => {
      calls += 1;
      return OTHER;
    };
    const first = pickKeyPair(null, create);
    expect(first.pair).toEqual(OTHER);
    expect(first.created).toBe(true);
    expect(calls).toBe(1);

    /* Следующее включение читает уже сохранённое и ничего не меняет. */
    const second = pickKeyPair(serializeKeyPair(first.pair), create);
    expect(second.pair).toEqual(OTHER);
    expect(second.created).toBe(false);
    expect(calls).toBe(1);
  });

  it("повреждённая запись заменяется новым ключом, а не ломает подключение", () => {
    const result = pickKeyPair("{\"privateKey\":\"мусор\"}", () => OTHER);
    expect(result.pair).toEqual(OTHER);
    expect(result.created).toBe(true);
  });
});
