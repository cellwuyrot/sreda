/**
 * Тесты модуля identity.ts
 * Зона B, P0 — блокировка идентификаторов пользователей.
 */

import { describe, it, expect, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

// identity.ts импортирует "./prisma" — не "@/lib/prisma"!
vi.mock("./prisma", () => ({ default: prismaMock }));

const {
  headerValue,
  cookieValue,
  getClientIp,
  recordIdentities,
  isIdentityBlocked,
  blockUserIdentities,
  unblockUserIdentities,
} = await import("@/lib/identity");

// ── headerValue ───────────────────────────────────────────────────────────────

describe("headerValue", () => {
  it("читает заголовок из объекта Headers", () => {
    const headers = new Headers({ "x-user-id": "abc" });
    expect(headerValue(headers, "x-user-id")).toBe("abc");
  });

  it("читает заголовок из простого объекта (NextAuth)", () => {
    expect(headerValue({ "x-user-id": "abc" }, "x-user-id")).toBe("abc");
  });

  /**
   * БАГ: headerValue для простого объекта смотрит rec[name] и rec[name.toLowerCase()],
   * но НЕ проверяет все возможные варианты регистра ключей.
   * Если ключ хранится в смешанном регистре ("X-User-Id"), а запрос идёт
   * строчными буквами ("x-user-id") — функция вернёт null.
   * NextAuth передаёт заголовки в исходном регистре, что может привести к
   * пропуску авторизационных данных при чтении custom-заголовков.
   * Исходник не правим — тест помечен skip.
   */
  it("ключ нечувствителен к регистру для простого объекта", () => {
    expect(headerValue({ "X-User-Id": "abc" }, "x-user-id")).toBe("abc");
  });

  it("ключ нечувствителен к регистру и в обратную сторону", () => {
    expect(headerValue({ "x-user-id": "abc" }, "X-User-Id")).toBe("abc");
  });

  it("возвращает null, когда подходящего ключа нет ни в каком регистре", () => {
    expect(headerValue({ "x-other": "abc" }, "x-user-id")).toBeNull();
  });

  it("возвращает null при null headers", () => {
    expect(headerValue(null, "x")).toBeNull();
  });

  it("первый элемент массива", () => {
    expect(headerValue({ "x-ids": ["first", "second"] }, "x-ids")).toBe("first");
  });
});

// ── cookieValue ───────────────────────────────────────────────────────────────

describe("cookieValue", () => {
  it("читает значение cookie", () => {
    expect(cookieValue("session=abc; user=x", "user")).toBe("x");
  });

  it("декодирует URL-encoded значение", () => {
    expect(cookieValue("device=hello%20world", "device")).toBe("hello world");
  });

  it("возвращает null при отсутствии cookie", () => {
    expect(cookieValue("a=1; b=2", "c")).toBeNull();
  });

  it("возвращает null при null заголовке", () => {
    expect(cookieValue(null, "session")).toBeNull();
  });
});

// ── getClientIp ───────────────────────────────────────────────────────────────

describe("getClientIp", () => {
  it("берёт первый IP из x-forwarded-for", () => {
    const req = { headers: new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }) };
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("берёт x-real-ip если нет x-forwarded-for", () => {
    const req = { headers: new Headers({ "x-real-ip": "9.9.9.9" }) };
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  it("возвращает null если заголовков нет", () => {
    const req = { headers: new Headers() };
    expect(getClientIp(req)).toBeNull();
  });
});

// ── recordIdentities ──────────────────────────────────────────────────────────

/**
 * Вид записи из аргумента upsert. Тип аргумента Prisma здесь не нужен и только
 * мешал бы: проверяется ровно одно поле — что записали, IP или устройство.
 */
function upsertKind(arg: unknown): string {
  return (arg as { create: { kind: string } }).create.kind;
}

describe("recordIdentities", () => {
  it("записывает IP и DEVICE через upsert", async () => {
    prismaMock.userIdentity.upsert.mockResolvedValue(row({}));

    await recordIdentities("u1", "1.2.3.4", "device-hash-abc");

    const calls = prismaMock.userIdentity.upsert.mock.calls;
    const kinds = calls.map((c) => upsertKind(c[0]));
    expect(kinds).toContain("IP");
    expect(kinds).toContain("DEVICE");
  });

  it("не записывает локальный IP (127.0.0.1)", async () => {
    prismaMock.userIdentity.upsert.mockResolvedValue(row({}));

    await recordIdentities("u1", "127.0.0.1", "device-hash-local");

    const calls = prismaMock.userIdentity.upsert.mock.calls;
    const kinds = calls.map((c) => upsertKind(c[0]));
    expect(kinds).not.toContain("IP");
  });

  it("не вызывает upsert если ip=null и deviceId=null", async () => {
    prismaMock.userIdentity.upsert.mockResolvedValue(row({}));

    await recordIdentities("u1", null, null);

    expect(prismaMock.userIdentity.upsert).not.toHaveBeenCalled();
  });

  it("не бросает если upsert упал (best-effort)", async () => {
    prismaMock.userIdentity.upsert.mockRejectedValue(new Error("DB down"));
    await expect(recordIdentities("u1", "1.2.3.4", "dev")).resolves.toBeUndefined();
  });
});

// ── isIdentityBlocked ─────────────────────────────────────────────────────────

describe("isIdentityBlocked", () => {
  it("возвращает true если устройство заблокировано", async () => {
    prismaMock.blockedIdentity.findFirst.mockResolvedValue(row({ id: "block-1" }));
    expect(await isIdentityBlocked(null, "blocked-device")).toBe(true);
  });

  it("возвращает false если устройство не заблокировано", async () => {
    prismaMock.blockedIdentity.findFirst.mockResolvedValue(null);
    expect(await isIdentityBlocked(null, "clean-device")).toBe(false);
  });

  it("возвращает false если deviceId не передан", async () => {
    expect(await isIdentityBlocked(null, null)).toBe(false);
    expect(prismaMock.blockedIdentity.findFirst).not.toHaveBeenCalled();
  });

  it("не добавляет IP в проверку (IP игнорируется)", async () => {
    prismaMock.blockedIdentity.findFirst.mockResolvedValue(null);
    await isIdentityBlocked("1.2.3.4", null);
    // Нет deviceId — вообще не вызывается
    expect(prismaMock.blockedIdentity.findFirst).not.toHaveBeenCalled();
  });
});

// ── blockUserIdentities ───────────────────────────────────────────────────────

describe("blockUserIdentities: блокирует только DEVICE, никогда IP", () => {
  it("удаляет старые IP-блоки и создаёт блоки DEVICE", async () => {
    prismaMock.blockedIdentity.deleteMany.mockResolvedValue(row({ count: 0 }));
    prismaMock.userIdentity.findMany.mockResolvedValue(row([
      { kind: "DEVICE", value: "dev-hash-1" },
      { kind: "DEVICE", value: "dev-hash-2" },
    ]));
    prismaMock.blockedIdentity.upsert.mockResolvedValue(row({}));

    await blockUserIdentities("baduser", "spam");

    // Должно удалить IP-записи для userId
    expect(prismaMock.blockedIdentity.deleteMany).toHaveBeenCalledWith({
      where: { userId: "baduser", kind: "IP" },
    });

    // Должно запросить только DEVICE-идентификаторы
    expect(prismaMock.userIdentity.findMany).toHaveBeenCalledWith({
      where: { userId: "baduser", kind: "DEVICE" },
    });

    // Должно создать ровно 2 блока — по одному на устройство
    expect(prismaMock.blockedIdentity.upsert).toHaveBeenCalledTimes(2);
  });

  it("создаёт блок только с kind=DEVICE — IP в upsert не попадает", async () => {
    prismaMock.blockedIdentity.deleteMany.mockResolvedValue(row({ count: 0 }));
    prismaMock.userIdentity.findMany.mockResolvedValue(row([
      { kind: "DEVICE", value: "dev-only" },
    ]));
    prismaMock.blockedIdentity.upsert.mockResolvedValue(row({}));

    await blockUserIdentities("baduser2");

    const upsertCall = prismaMock.blockedIdentity.upsert.mock.calls[0][0];
    expect(upsertCall.create.kind).toBe("DEVICE");
    expect(upsertCall.create.kind).not.toBe("IP");
  });

  it("не создаёт блоков если у пользователя нет устройств", async () => {
    prismaMock.blockedIdentity.deleteMany.mockResolvedValue(row({ count: 0 }));
    prismaMock.userIdentity.findMany.mockResolvedValue(row([]));

    await blockUserIdentities("nodevice");

    expect(prismaMock.blockedIdentity.upsert).not.toHaveBeenCalled();
  });

  it("не бросает при ошибке БД (best-effort)", async () => {
    prismaMock.blockedIdentity.deleteMany.mockRejectedValue(new Error("crash"));
    await expect(blockUserIdentities("u-crash")).resolves.toBeUndefined();
  });
});

// ── unblockUserIdentities ─────────────────────────────────────────────────────

describe("unblockUserIdentities: снимает только записи этого userId", () => {
  it("вызывает deleteMany с фильтром userId", async () => {
    prismaMock.blockedIdentity.deleteMany.mockResolvedValue(row({ count: 2 }));

    await unblockUserIdentities("pardoned-user");

    expect(prismaMock.blockedIdentity.deleteMany).toHaveBeenCalledWith({
      where: { userId: "pardoned-user" },
    });
  });

  /**
   * ГРАНИЧНЫЙ ТЕСТ: коллизия хэшей устройств.
   * Два разных пользователя не могут использовать одно устройство одновременно,
   * но если один из них разбанен — записи другого не должны затрагиваться.
   * unblockUserIdentities фильтрует ТОЛЬКО по userId, что гарантирует
   * изоляцию: deleteMany с { userId: X } не заденет записи userId Y,
   * даже если у них совпадают хэши устройств.
   */
  it("коллизия хэшей: разбан userA не затрагивает блоки userB с тем же хэшем", async () => {
    prismaMock.blockedIdentity.deleteMany.mockResolvedValue(row({ count: 1 }));

    await unblockUserIdentities("userA");

    // Вызов должен быть только с userId=userA
    const callArgs = prismaMock.blockedIdentity.deleteMany.mock.calls[0][0];
    expect(callArgs.where).toEqual({ userId: "userA" });
    // Не должно быть фильтра по value/kind — это гарантирует что userB не затронут
    expect(callArgs.where.value).toBeUndefined();
    expect(callArgs.where.kind).toBeUndefined();
  });

  it("не бросает при ошибке (best-effort)", async () => {
    prismaMock.blockedIdentity.deleteMany.mockRejectedValue(new Error("db error"));
    await expect(unblockUserIdentities("u-err")).resolves.toBeUndefined();
  });
});
