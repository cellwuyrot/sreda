/**
 * Тесты: POST /api/voice/force-unmute — снятие принудительного заглушения.
 *
 * Главное здесь — кто и что вправе снять. Прежде маршрут снимал ровно то, что
 * попросил клиент (`deafen`), а клиент брал это из своего снимка состава
 * комнаты. Снимок устаревает, и человек оставался без наушников после «снять
 * заглушение» — со его стороны это выглядело как поломка связи, а не как
 * решение модератора. Теперь снятие всегда полное, а нужное звание сервер
 * определяет по своему состоянию: замок с наушниками снимает модератор,
 * замок только на микрофон — проводник.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/socketEmit", () => ({ emitToUser: vi.fn() }));

import { getServerSession } from "next-auth";
import { emitToUser } from "@/lib/socketEmit";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);

type ForceLock = { muted: boolean; deafened: boolean };

const globals = globalThis as Record<string, unknown>;

/** Замок, который «помнит» сокет-сервер. `null` — сервер не отвечает. */
function stubLock(lock: ForceLock | null) {
  if (lock === null) {
    delete globals.__voiceForceLock;
    return;
  }
  globals.__voiceForceLock = () => lock;
}

const unmuteCalls: Array<[string, string]> = [];

function request(body: unknown) {
  return new Request("http://localhost/api/voice/force-unmute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BODY = { targetUserId: "u2", channelId: "ch1" };

function mockRanks(callerRole: string | null, targetRole: string | null) {
  prismaMock.groupMember.findUnique
    .mockResolvedValueOnce(callerRole ? row({ role: callerRole, guidedUntil: null }) : row(null))
    .mockResolvedValueOnce(targetRole ? row({ role: targetRole, guidedUntil: null }) : row(null));
}

beforeEach(() => {
  unmuteCalls.length = 0;
  vi.mocked(emitToUser).mockClear();
  mockSession.mockResolvedValue({ user: { id: "u1" } } as never);
  prismaMock.channel.findUnique.mockResolvedValue(row({ groupId: "g1" }));
  globals.__forceUnmuteUser = (channelId: string, targetUserId: string) => {
    unmuteCalls.push([channelId, targetUserId]);
  };
  stubLock({ muted: true, deafened: false });
});

afterEach(() => {
  delete globals.__forceUnmuteUser;
  delete globals.__voiceForceLock;
});

describe("POST /api/voice/force-unmute", () => {
  it("без сессии → 401", async () => {
    mockSession.mockResolvedValue(null);
    expect((await POST(request(BODY))).status).toBe(401);
  });

  it("без полей → 400", async () => {
    expect((await POST(request({ channelId: "ch1" }))).status).toBe(400);
  });

  it("канал не найден → 404", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(null));
    expect((await POST(request(BODY))).status).toBe(404);
  });

  it("замок только на микрофон — снимает проводник", async () => {
    stubLock({ muted: true, deafened: false });
    mockRanks("GUIDE", "MEMBER");
    expect((await POST(request(BODY))).status).toBe(200);
    expect(unmuteCalls).toEqual([["ch1", "u2"]]);
  });

  /**
   * ИНВАРИАНТ: снять «мик + наушники» может тот, кто вправе это наложить, —
   * модератор и выше. Иначе проводник снимал бы меру, принять которую сам не
   * может.
   */
  it("ИНВАРИАНТ: замок с наушниками проводнику не снять", async () => {
    stubLock({ muted: true, deafened: true });
    mockRanks("GUIDE", "MEMBER");
    expect((await POST(request(BODY))).status).toBe(403);
    expect(unmuteCalls).toEqual([]);
  });

  it("замок с наушниками снимает модератор", async () => {
    stubLock({ muted: true, deafened: true });
    mockRanks("MODERATOR", "MEMBER");
    expect((await POST(request(BODY))).status).toBe(200);
  });

  /**
   * ИНВАРИАНТ: неизвестное состояние трактуется в сторону запрета. Ошибиться,
   * не дав снять, — это неудобство; ошибиться, сняв то, на что права не было, —
   * это дыра в модерации.
   */
  it("ИНВАРИАНТ: сокет-сервер молчит — проводнику отказ", async () => {
    stubLock(null);
    mockRanks("GUIDE", "MEMBER");
    expect((await POST(request(BODY))).status).toBe(403);
  });

  it("сокет-сервер молчит — модератору снятие разрешено", async () => {
    stubLock(null);
    mockRanks("MODERATOR", "MEMBER");
    expect((await POST(request(BODY))).status).toBe(200);
  });

  it("равный по званию → 403", async () => {
    mockRanks("MODERATOR", "MODERATOR");
    expect((await POST(request(BODY))).status).toBe(403);
  });

  /**
   * ИНВАРИАНТ: цель узнаёт о снятии обоих замков сразу. Отдельного события «сняли
   * только микрофон» больше нет: полумера оставляла человека без звука, и
   * отличить её от поломки связи он не мог.
   */
  it("ИНВАРИАНТ: цели уходит снятие и микрофона, и наушников", async () => {
    mockRanks("OWNER", "MEMBER");
    await POST(request(BODY));
    expect(emitToUser).toHaveBeenCalledWith("u2", "voice:force-undeafen", {});
  });
});
