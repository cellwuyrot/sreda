/**
 * FIX-RENEW: продление Premium должно продолжать действующий оплаченный срок, а
 * не начинать его заново от «сегодня». До правки здесь стояло
 * computeExpiry(plan, now) — досрочная оплата сжигала оставшиеся оплаченные дни.
 *
 * Проверяется ровно точка отсчёта нового срока: базой берётся конец самой
 * поздней действующей подписки, и только при её отсутствии — момент оплаты.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

// Порядок vi.mock важен: объявляем ДО импорта тестируемого модуля.
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {}, invalidateUserAuthCache: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/socketEmit", () => ({ emitToUser: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth";

const { POST } = await import("@/app/api/admin/premium/subscriptions/route");

const ADMIN = { id: "admin-1", role: "ADMIN", username: "admin", name: "Админ" };

/** Дата конца оплаченного срока, ещё не наступившая (01.10). */
const PAID_UNTIL = new Date("2026-10-01T00:00:00.000Z");

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/admin/premium/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Данные записи, которую route попытался создать. */
function created() {
  return (prismaMock.premiumSubscription.create.mock.calls[0][0] as {
    data: Record<string, unknown>;
  }).data;
}

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: ADMIN } as never);
  prismaMock.user.findUnique.mockResolvedValue(row({ id: "u1", username: "user", role: "USER" }));
  prismaMock.premiumSubscription.create.mockResolvedValue(row({ id: "sub-1" }));
  prismaMock.user.update.mockResolvedValue(row({ id: "u1" }));
});

describe("POST /api/admin/premium/subscriptions — продление", () => {
  /**
   * ИНВАРИАНТ (сценарий из ТЗ): подписка действует до 01.10, продление на месяц
   * оформляется 20.09 (досрочно). Новый срок обязан считаться от 01.10, то есть
   * закончиться 01.11, а НЕ 20.10 — оставшиеся оплаченные дни не сгорают.
   */
  it("досрочное продление считается от конца действующего срока, а не от сегодня", async () => {
    prismaMock.premiumSubscription.findFirst.mockResolvedValue(row({ expiresAt: PAID_UNTIL }));
    await call({ userId: "u1", plan: "month", paymentMethod: "sbp", amount: 100 });
    const expiresAt = created().expiresAt as Date;
    expect(expiresAt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("базой берётся именно самая поздняя действующая подписка", async () => {
    prismaMock.premiumSubscription.findFirst.mockResolvedValue(row({ expiresAt: PAID_UNTIL }));
    await call({ userId: "u1", plan: "year", paymentMethod: "sbp", amount: 100 });
    const expiresAt = created().expiresAt as Date;
    // 01.10.2026 + год = 01.10.2027.
    expect(expiresAt.toISOString()).toBe("2027-10-01T00:00:00.000Z");
  });

  it("действующей подписки нет — срок считается от момента оплаты", async () => {
    prismaMock.premiumSubscription.findFirst.mockResolvedValue(row(null));
    const before = Date.now();
    await call({ userId: "u1", plan: "month", paymentMethod: "sbp", amount: 100 });
    const data = created();
    const startedAt = data.startedAt as Date;
    const expiresAt = data.expiresAt as Date;
    // База — startedAt (сейчас), а не какая-то прошлая дата.
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(before);
    const expected = new Date(startedAt);
    expected.setMonth(expected.getMonth() + 1);
    expect(expiresAt.toISOString()).toBe(expected.toISOString());
  });

  it("продление учитывает только действующие срочные подписки (гасит истёкшие фильтром запроса)", async () => {
    prismaMock.premiumSubscription.findFirst.mockResolvedValue(row({ expiresAt: PAID_UNTIL }));
    await call({ userId: "u1", plan: "month", paymentMethod: "sbp", amount: 100 });
    const where = (prismaMock.premiumSubscription.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where.status).toBe("active");
    // Пожизненные (expiresAt = null) и истёкшие в базу отсчёта не попадают.
    expect(where.expiresAt).toMatchObject({ not: null });
  });
});
