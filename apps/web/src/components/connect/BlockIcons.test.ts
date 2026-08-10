import { describe, it, expect } from "vitest";
import { blockIconKeyForName, isBlockIconKey, BLOCK_ICON_POOL } from "./BlockIcons";

describe("blockIconKeyForName", () => {
  it("возвращает null для пустой строки", () => {
    expect(blockIconKeyForName("")).toBeNull();
  });

  it("находит ключ 'ai' по слову 'помощник'", () => {
    expect(blockIconKeyForName("Помощник по задачам")).toBe("ai");
  });

  it("находит ключ 'ai' по слову 'ии'", () => {
    expect(blockIconKeyForName("ИИ-раздел")).toBe("ai");
  });

  it("находит ключ 'cloud' по слову 'облач'", () => {
    expect(blockIconKeyForName("Облачное хранилище")).toBe("cloud");
  });

  it("находит ключ 'support' по слову 'поддержк'", () => {
    expect(blockIconKeyForName("Поддержка клиентов")).toBe("support");
  });

  it("находит ключ 'telegram' по слову 'telegram'", () => {
    expect(blockIconKeyForName("Telegram bot")).toBe("telegram");
  });

  // Порядок в KEYWORDS значим: узкое слово должно стоять раньше широкого.
  // «CRM-система» содержит и «crm», и «систем» — пока «систем» стояла выше,
  // раздел получал значок «Системы».
  it("находит ключ 'crm' по слову 'crm', а не перехватывается 'systems'", () => {
    expect(blockIconKeyForName("CRM-система")).toBe("crm");
  });

  it("название без CRM по-прежнему достаётся ключу 'systems'", () => {
    expect(blockIconKeyForName("Настройка систем")).toBe("systems");
  });

  it("находит ключ 'announce' по слову 'объявл'", () => {
    expect(blockIconKeyForName("Объявления")).toBe("announce");
  });

  // Совпадение ищется подстрокой, поэтому ключ должен быть общей частью форм:
  // «облач» не входит в «облако», и раздел оставался без значка вовсе.
  it("регистронезависимо и покрывает обе формы корня: 'ОБЛАКО' и 'облачное'", () => {
    expect(blockIconKeyForName("ОБЛАКО")).toBe("cloud");
    expect(blockIconKeyForName("Облачное хранилище")).toBe("cloud");
  });

  it("возвращает null для случайного имени без совпадений", () => {
    expect(blockIconKeyForName("Неизвестный раздел xyz")).toBeNull();
  });

  it("находит ключ 'honest' по ключевым словам честн+знак", () => {
    expect(blockIconKeyForName("Честный знак")).toBe("honest");
  });
});

describe("isBlockIconKey", () => {
  it("возвращает true для всех ключей в пуле", () => {
    for (const { key } of BLOCK_ICON_POOL) {
      expect(isBlockIconKey(key)).toBe(true);
    }
  });

  it("возвращает false для строки, которой нет в пуле", () => {
    expect(isBlockIconKey("unknown_icon")).toBe(false);
  });

  it("возвращает false для числа", () => {
    expect(isBlockIconKey(42)).toBe(false);
  });

  it("возвращает false для null", () => {
    expect(isBlockIconKey(null)).toBe(false);
  });

  it("возвращает false для пустой строки", () => {
    expect(isBlockIconKey("")).toBe(false);
  });

  it("возвращает true для 'generic'", () => {
    expect(isBlockIconKey("generic")).toBe(true);
  });
});
