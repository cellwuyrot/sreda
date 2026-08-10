/**
 * Тесты: /api/workspace/reminders — напоминания на карточках.
 *
 * Проверяется то, ради чего маршрут заводился, и то, чем он может навредить:
 *
 *   • время в прошлом не принимается — иначе напоминание сработает мгновенно,
 *     в первый же обход, и человек получит не то, что ставил;
 *   • повторная постановка ЗАМЕНЯЕТ прежнюю, а не добавляет вторую;
 *   • чужую карточку не тронуть: человек берётся из сессии, а не из тела.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => null) }));

import { getServerSession } from "next-auth";
const mockSession = vi.mocked(getServerSession);

const HOUR = 60 * 60 * 1000;

async function call(method: "GET" | "POST" | "DELETE", body?: unknown) {
  const mod = await import("@/app/api/workspace/reminders/route");
  const request = new Request("http://localhost/api/workspace/reminders", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
  const res = method === "GET" ? await mod.GET() : method === "POST" ? await mod.POST(request) : await mod.DELETE(request);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
  prismaMock.cardReminder.upsert.mockResolvedValue(row({}));
  prismaMock.cardReminder.deleteMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.cardReminder.findMany.mockResolvedValue([
    row({ cardId: "c1", remindAt: new Date("2026-08-03T09:00:00Z") }),
  ]);
});

describe("кто ставит напоминания", () => {
  it("без входа — 401 на любом действии", async () => {
    mockSession.mockResolvedValue(null);
    expect((await call("GET")).status).toBe(401);
    expect((await call("POST", { cardId: "c1", remindAt: Date.now() + HOUR })).status).toBe(401);
    expect((await call("DELETE", { cardId: "c1" })).status).toBe(401);
  });
});

describe("постановка", () => {
  it("нормальное время принимается", async () => {
    const remindAt = Date.now() + HOUR;
    const res = await call("POST", { cardId: "c1", title: "Позвонить", link: "/workspace", remindAt });
    expect(res.status).toBe(200);
    expect(prismaMock.cardReminder.upsert).toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: время в прошлом не принимается", async () => {
    /* Такое напоминание сработает в первый же обход — человек ждал другого. */
    const res = await call("POST", { cardId: "c1", remindAt: Date.now() - HOUR });
    expect(res.status).toBe(400);
    expect(prismaMock.cardReminder.upsert).not.toHaveBeenCalled();
  });

  it("ФИКСАЦИЯ: слишком далёкое время — тоже отказ", async () => {
    /* Почти всегда это промах в поле ввода года, а не намерение. */
    const res = await call("POST", { cardId: "c1", remindAt: Date.now() + 400 * 24 * HOUR });
    expect(res.status).toBe(400);
  });

  it("без карточки — отказ", async () => {
    expect((await call("POST", { remindAt: Date.now() + HOUR })).status).toBe(400);
    expect((await call("POST", { cardId: "с пробелом", remindAt: Date.now() + HOUR })).status).toBe(400);
  });

  it("ИНВАРИАНТ: повторная постановка заменяет прежнюю", async () => {
    /* Иначе передвинутый срок оставлял бы позади старое напоминание, и человек
       получал бы оба — ровно то, от чего отказался, передвигая. */
    await call("POST", { cardId: "c1", title: "Позвонить", remindAt: Date.now() + HOUR });
    const args = prismaMock.cardReminder.upsert.mock.calls[0]![0] as {
      where: { userId_cardId: { userId: string; cardId: string } };
      update: { firedAt: null };
    };
    expect(args.where.userId_cardId).toEqual({ userId: "u1", cardId: "c1" });
    /* И сработавшее напоминание снова начинает ждать. */
    expect(args.update.firedAt).toBeNull();
  });

  it("ИНВАРИАНТ: уведомление не уводит на чужой сайт", async () => {
    await call("POST", { cardId: "c1", link: "https://evil.tld", remindAt: Date.now() + HOUR });
    const args = prismaMock.cardReminder.upsert.mock.calls[0]![0] as { create: { link: string } };
    expect(args.create.link).toBe("/workspace");
  });

  it("безымянная карточка получает понятный заголовок", async () => {
    await call("POST", { cardId: "c1", title: "   ", remindAt: Date.now() + HOUR });
    const args = prismaMock.cardReminder.upsert.mock.calls[0]![0] as { create: { title: string } };
    expect(args.create.title).toBe("Карточка без названия");
  });
});

describe("снятие и список", () => {
  it("ИНВАРИАНТ: снимается только своё", async () => {
    /* Человек берётся из сессии: зная чужой идентификатор карточки, чужое
       напоминание не убрать. */
    await call("DELETE", { cardId: "c1" });
    expect(prismaMock.cardReminder.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", cardId: "c1" } });
  });

  it("список отдаёт только то, что ещё не сработало", async () => {
    const res = await call("GET");
    expect(res.body.reminders[0]).toMatchObject({ cardId: "c1" });
    const args = prismaMock.cardReminder.findMany.mock.calls[0]![0] as { where: { firedAt: null } };
    expect(args.where.firedAt).toBeNull();
  });
});
