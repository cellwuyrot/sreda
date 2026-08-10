/**
 * Тесты: GET /api/groups/[id]/presence.
 *
 * Маршрут появился из-за замерзающих отметок присутствия в списке участников.
 * Проверяем договор: право видеть, что именно отдаётся и по какой границе.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";
import { ONLINE_WINDOW_MS } from "@/lib/timeAgo";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

const URL_PRESENCE = "http://localhost/api/groups/g1/presence";

function makeParams(id = "g1") {
  return { params: Promise.resolve({ id }) };
}

async function call() {
  const { GET } = await import("@/app/api/groups/[id]/presence/route");
  const res = await GET(new Request(URL_PRESENCE), makeParams());
  return { status: res.status, headers: res.headers, body: await res.json() };
}

beforeEach(() => {
  mockGetServerSession.mockResolvedValue({ user: { id: "me", role: "USER" } } as never);
});

describe("право видеть присутствие", () => {
  it("без сессии — 401", async () => {
    mockGetServerSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  /**
   * ИНВАРИАНТ: присутствие участников — не публичные данные. Право то же, что у
   * списка участников: видит только участник сообщества.
   */
  it("ИНВАРИАНТ: не участник получает 403 и не узнаёт, кто в сети", async () => {
    prismaMock.groupMember.findUnique.mockResolvedValue(null);
    const { status, body } = await call();
    expect(status).toBe(403);
    expect(body.online).toBeUndefined();
    expect(prismaMock.groupMember.findMany).not.toHaveBeenCalled();
  });
});

describe("что отдаётся", () => {
  beforeEach(() => {
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ id: "m1" }));
  });

  it("только идентификаторы присутствующих и момент ответа", async () => {
    prismaMock.groupMember.findMany.mockResolvedValue(row([{ userId: "u1" }, { userId: "u2" }]));
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.online).toEqual(["u1", "u2"]);
    expect(typeof body.at).toBe("string");
  });

  /**
   * ИНВАРИАНТ: ответ ограничен присутствующими, а не размером сообщества — на
   * этом и держится дешевизна частого запроса.
   */
  it("ИНВАРИАНТ: выбираются только те, кто в окне присутствия", async () => {
    prismaMock.groupMember.findMany.mockResolvedValue(row([]));
    await call();
    const where = prismaMock.groupMember.findMany.mock.calls[0][0] as {
      where: { groupId: string; user: { showOnline: boolean; lastSeen: { gte: Date } } };
    };
    expect(where.where.groupId).toBe("g1");
    const gte = where.where.user.lastSeen.gte.getTime();
    /* Граница — «сейчас минус окно», с запасом на время выполнения теста. */
    expect(Date.now() - gte).toBeGreaterThanOrEqual(ONLINE_WINDOW_MS);
    expect(Date.now() - gte).toBeLessThan(ONLINE_WINDOW_MS + 5_000);
  });

  /**
   * ИНВАРИАНТ: скрывший присутствие в список не попадает. Его отметку не
   * обновляет и удар сети, но полагаться на одно это нельзя — запрет должен быть
   * виден в самом запросе.
   */
  it("ИНВАРИАНТ: showOnline=false отфильтрован в запросе", async () => {
    prismaMock.groupMember.findMany.mockResolvedValue(row([]));
    await call();
    const where = prismaMock.groupMember.findMany.mock.calls[0][0] as {
      where: { user: { showOnline: boolean } };
    };
    expect(where.where.user.showOnline).toBe(true);
  });

  it("выбираются только идентификаторы: тяжёлые поля не тянем", async () => {
    prismaMock.groupMember.findMany.mockResolvedValue(row([]));
    await call();
    const args = prismaMock.groupMember.findMany.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(args.select).toEqual({ userId: true });
  });

  /**
   * ИНВАРИАНТ: ответ нельзя кэшировать. Иначе присутствие снова «замрёт» — только
   * теперь в кэше браузера или прокси, и это будет ещё труднее заметить.
   */
  it("ИНВАРИАНТ: ответ помечен no-store", async () => {
    prismaMock.groupMember.findMany.mockResolvedValue(row([]));
    const { headers } = await call();
    expect(headers.get("Cache-Control")).toBe("no-store");
  });

  it("пустое сообщество — пустой список, а не отказ", async () => {
    prismaMock.groupMember.findMany.mockResolvedValue(row([]));
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.online).toEqual([]);
  });
});
