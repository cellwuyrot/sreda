/**
 * FIX-RENEW (VPN): «Ускоренный интернет» продлевается по тому же правилу, что и
 * Premium — от конца действующего оплаченного срока, а не от «сегодня». Здесь
 * этот инвариант закрепляется тестом, чтобы поведение двух систем не разошлось.
 *
 * Точка отсчёта берётся из user.vpnAccessUntil (пока доступ ещё действует).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

// Порядок vi.mock важен: объявляем ДО импорта тестируемого модуля.
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/audit", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/socketEmit", () => ({ emitToUser: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth";

const { POST } = await import("@/app/api/admin/vpn/subscriptions/route");

const ADMIN = { id: "admin-1", role: "ADMIN", username: "admin", name: "Админ" };

/** Доступ оплачен до 01.10, ещё действует. */
const PAID_UNTIL = new Date("2026-10-01T00:00:00.000Z");

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/admin/vpn/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Данные записи, которую route попытался создать. */
function created() {
  return (prismaMock.vpnSubscription.create.mock.calls[0][0] as {
    data: Record<string, unknown>;
  }).data;
}

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: ADMIN } as never);
  prismaMock.vpnSubscription.create.mockResolvedValue(row({ id: "sub-1" }));
  prismaMock.user.update.mockResolvedValue(row({ id: "u1" }));
});

describe("POST /api/admin/vpn/subscriptions — продление", () => {
  /**
   * ИНВАРИАНТ (сценарий из ТЗ): доступ оплачен до 01.10, продление на месяц
   * оформляется досрочно. Новый срок обязан считаться от 01.10 (→ 01.11), а не
   * от сегодня — оставшиеся оплаченные дни не сгорают.
   */
  it("досрочное продление считается от конца действующего срока, а не от сегодня", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      row({ id: "u1", username: "user", vpnAccess: true, vpnAccessUntil: PAID_UNTIL }),
    );
    await call({ userId: "u1", plan: "month", paymentMethod: "sbp", amount: 100 });
    const expiresAt = created().expiresAt as Date;
    expect(expiresAt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("доступа ещё нет — срок считается от момента оплаты", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      row({ id: "u1", username: "user", vpnAccess: false, vpnAccessUntil: null }),
    );
    const before = Date.now();
    await call({ userId: "u1", plan: "month", paymentMethod: "sbp", amount: 100 });
    const data = created();
    const startedAt = data.startedAt as Date;
    const expiresAt = data.expiresAt as Date;
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(before);
    const expected = new Date(startedAt);
    expected.setMonth(expected.getMonth() + 1);
    expect(expiresAt.toISOString()).toBe(expected.toISOString());
  });

  it("истёкший доступ не продлевается «задним числом» — база от момента оплаты", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      row({
        id: "u1",
        username: "user",
        vpnAccess: true,
        vpnAccessUntil: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );
    const before = Date.now();
    await call({ userId: "u1", plan: "month", paymentMethod: "sbp", amount: 100 });
    const startedAt = created().startedAt as Date;
    // vpnAccessUntil в прошлом → базой берётся startedAt, а не старая дата.
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
