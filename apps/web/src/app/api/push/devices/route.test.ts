/**
 * Тесты: POST/DELETE /api/push/devices — привязка устройства к аккаунту.
 *
 * Здесь одно опасное место, и оно проверяется первым: телефон один, а людей может
 * быть двое. Если адрес устройства не переприязывать при входе другого человека,
 * прежний владелец продолжит получать на этот телефон уведомления о своей
 * переписке — это утечка, а не неудобство.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/push", () => ({ pushConfigured: () => true }));

import { getServerSession } from "next-auth";
import { rateLimit } from "@/lib/rateLimit";

const mockSession = vi.mocked(getServerSession);
const TOKEN = "f".repeat(150);

function request(method: "POST" | "DELETE", body: unknown) {
  return new Request("http://localhost/api/push/devices", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/push/devices/route");
  const res = await POST(request("POST", body));
  return { status: res.status, body: await res.json() };
}

async function del(body: unknown) {
  const { DELETE } = await import("@/app/api/push/devices/route");
  const res = await DELETE(request("DELETE", body));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
  prismaMock.pushDevice.upsert.mockResolvedValue(row({ id: "d1" }));
  prismaMock.pushDevice.deleteMany.mockResolvedValue(row({ count: 1 }));
  vi.mocked(rateLimit).mockResolvedValue(null);
});

describe("привязка устройства", () => {
  it("без сессии — 401 и ничего не пишем", async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ token: TOKEN })).status).toBe(401);
    expect(prismaMock.pushDevice.upsert).not.toHaveBeenCalled();
  });

  /**
   * ИНВАРИАНТ И ЕСТЬ САМОЕ ВАЖНОЕ: адрес устройства принадлежит тому, кто вошёл
   * ПОСЛЕДНИМ. Один телефон — один владелец уведомлений.
   */
  it("ИНВАРИАНТ: повторная привязка переносит устройство к вошедшему", async () => {
    await post({ token: TOKEN });
    const args = prismaMock.pushDevice.upsert.mock.calls[0][0] as {
      where: { token: string };
      create: { userId: string };
      update: { userId: string };
    };
    expect(args.where).toEqual({ token: TOKEN });
    expect(args.create.userId).toBe("u1");
    expect(args.update.userId).toBe("u1");
  });

  it("отметка «устройство живо» обновляется при каждой привязке", async () => {
    await post({ token: TOKEN });
    const args = prismaMock.pushDevice.upsert.mock.calls[0][0] as { update: { lastSeenAt: Date } };
    expect(args.update.lastSeenAt).toBeInstanceOf(Date);
  });

  it("мусор вместо адреса — 400", async () => {
    for (const token of ["", "короткий", 42, null, `${TOKEN} с пробелом`, "x".repeat(5000)]) {
      expect((await post({ token })).status).toBe(400);
    }
    expect(prismaMock.pushDevice.upsert).not.toHaveBeenCalled();
  });

  it("неизвестная платформа приводится к android, а не пишется как есть", async () => {
    await post({ token: TOKEN, platform: "symbian" });
    const args = prismaMock.pushDevice.upsert.mock.calls[0][0] as { create: { platform: string } };
    expect(args.create.platform).toBe("android");
  });

  /**
   * ИНВАРИАНТ: маршрут не отдаёт адрес устройства наружу. По нему можно доставить
   * уведомление, поэтому он только принимается.
   */
  it("ИНВАРИАНТ: адрес устройства не возвращается в ответе", async () => {
    const { body } = await post({ token: TOKEN });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("в ответе видно, работает ли доставка на этом сервере", async () => {
    expect((await post({ token: TOKEN })).body.delivery).toBe(true);
  });

  it("частые обращения ограничены", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(rateLimit).mockResolvedValue(NextResponse.json({ error: "too many" }, { status: 429 }));
    expect((await post({ token: TOKEN })).status).toBe(429);
    expect(prismaMock.pushDevice.upsert).not.toHaveBeenCalled();
  });
});

describe("отвязка устройства", () => {
  it("без сессии — 401", async () => {
    mockSession.mockResolvedValue(null);
    expect((await del({ token: TOKEN })).status).toBe(401);
  });

  /**
   * ИНВАРИАНТ: снять можно только своё устройство. Иначе, зная чужой адрес, можно
   * было бы отключить человеку уведомления.
   */
  it("ИНВАРИАНТ: удаление ограничено своими устройствами", async () => {
    await del({ token: TOKEN });
    expect(prismaMock.pushDevice.deleteMany).toHaveBeenCalledWith({
      where: { token: TOKEN, userId: "u1" },
    });
  });

  it("мусор вместо адреса — 400", async () => {
    expect((await del({ token: "нет" })).status).toBe(400);
    expect(prismaMock.pushDevice.deleteMany).not.toHaveBeenCalled();
  });
});
