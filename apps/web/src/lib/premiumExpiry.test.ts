/**
 * Срок подписки Premium.
 *
 * Договор, который здесь закрепляется: подписка с прошедшей датой перестаёт
 * действовать, но человек с ещё одной действующей подпиской премиума не теряет,
 * а администратору срок не указ — премиум ему даёт роль.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const emitToUser = vi.fn();
vi.mock("@/lib/socketEmit", () => ({ emitToUser: (...args: unknown[]) => emitToUser(...args) }));

const { expireOverduePremium, premiumDaysLeft } = await import("@/lib/premiumExpiry");

const NOW = new Date("2026-08-01T12:00:00.000Z");

beforeEach(() => {
  emitToUser.mockClear();
});

describe("expireOverduePremium", () => {
  it("без просроченных подписок ничего не пишет", async () => {
    prismaMock.premiumSubscription.findMany.mockResolvedValue(row([]));

    const result = await expireOverduePremium(NOW);

    expect(result).toEqual({ subscriptionsExpired: 0, usersDowngraded: 0 });
    expect(prismaMock.premiumSubscription.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it("помечает просроченную подписку и снимает премиум", async () => {
    prismaMock.premiumSubscription.findMany
      .mockResolvedValueOnce(row([{ id: "sub-1", userId: "u1" }])) // просроченные
      .mockResolvedValueOnce(row([])); // других действующих нет
    prismaMock.user.updateMany.mockResolvedValue(row({ count: 1 }));

    const result = await expireOverduePremium(NOW);

    expect(result).toEqual({ subscriptionsExpired: 1, usersDowngraded: 1 });
    expect(prismaMock.premiumSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["sub-1"] } },
      data: { status: "expired" },
    });
    expect(emitToUser).toHaveBeenCalledWith("u1", "account-premium-updated", { isPremium: false });
  });

  it("ищет только подписки с датой в прошлом", async () => {
    prismaMock.premiumSubscription.findMany.mockResolvedValue(row([]));

    await expireOverduePremium(NOW);

    const where = prismaMock.premiumSubscription.findMany.mock.calls[0][0] as {
      where: { status: string; expiresAt: { not: null; lt: Date } };
    };
    expect(where.where.status).toBe("active");
    expect(where.where.expiresAt.lt).toBe(NOW);
    // Бессрочная подписка (expiresAt = null) под условие не попадает.
    expect(where.where.expiresAt.not).toBeNull();
  });

  /**
   * Человек продлил заранее: старая запись истекла, новая действует. Флаг
   * трогать нельзя — иначе продление наказывало бы за расторопность.
   */
  it("не снимает премиум, когда есть другая действующая подписка", async () => {
    prismaMock.premiumSubscription.findMany
      .mockResolvedValueOnce(row([{ id: "sub-old", userId: "u1" }]))
      .mockResolvedValueOnce(row([{ userId: "u1" }]));

    const result = await expireOverduePremium(NOW);

    expect(result).toEqual({ subscriptionsExpired: 1, usersDowngraded: 0 });
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it("администратора не задевает: премиум ему даёт роль", async () => {
    prismaMock.premiumSubscription.findMany
      .mockResolvedValueOnce(row([{ id: "sub-1", userId: "admin-1" }]))
      .mockResolvedValueOnce(row([]));
    prismaMock.user.updateMany.mockResolvedValue(row({ count: 0 }));

    await expireOverduePremium(NOW);

    const args = prismaMock.user.updateMany.mock.calls[0][0] as {
      where: { role: { not: string } };
    };
    expect(args.where.role).toEqual({ not: "ADMIN" });
  });

  it("двух людей разбирает одним запросом на обновление", async () => {
    prismaMock.premiumSubscription.findMany
      .mockResolvedValueOnce(row([
        { id: "s1", userId: "u1" },
        { id: "s2", userId: "u2" },
      ]))
      .mockResolvedValueOnce(row([]));
    prismaMock.user.updateMany.mockResolvedValue(row({ count: 2 }));

    const result = await expireOverduePremium(NOW);

    expect(result.subscriptionsExpired).toBe(2);
    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledTimes(2);
  });

  it("две просроченные подписки одного человека не считаются дважды", async () => {
    prismaMock.premiumSubscription.findMany
      .mockResolvedValueOnce(row([
        { id: "s1", userId: "u1" },
        { id: "s2", userId: "u1" },
      ]))
      .mockResolvedValueOnce(row([]));
    prismaMock.user.updateMany.mockResolvedValue(row({ count: 1 }));

    await expireOverduePremium(NOW);

    expect(emitToUser).toHaveBeenCalledTimes(1);
  });
});

describe("premiumDaysLeft", () => {
  it("без срока — null", () => {
    expect(premiumDaysLeft(null, NOW)).toBeNull();
    expect(premiumDaysLeft(undefined, NOW)).toBeNull();
  });

  it("мусор вместо даты — null, а не NaN", () => {
    expect(premiumDaysLeft("не дата", NOW)).toBeNull();
  });

  it("ровно месяц вперёд — 31 день", () => {
    expect(premiumDaysLeft(new Date("2026-09-01T12:00:00.000Z"), NOW)).toBe(31);
  });

  it("начавшийся последний день считается за один, а не за ноль", () => {
    expect(premiumDaysLeft(new Date("2026-08-02T01:00:00.000Z"), NOW)).toBe(1);
  });

  it("сегодняшний конец срока — ноль", () => {
    expect(premiumDaysLeft(NOW, NOW)).toBe(0);
  });

  it("прошедший срок — отрицательное число", () => {
    expect(premiumDaysLeft(new Date("2026-07-25T12:00:00.000Z"), NOW)).toBe(-7);
  });

  it("принимает дату строкой, как приходит из JSON", () => {
    expect(premiumDaysLeft("2026-08-11T12:00:00.000Z", NOW)).toBe(10);
  });
});
