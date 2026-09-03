/**
 * Тесты: POST /api/voice/move-user — перенос участника между голосовыми каналами.
 *
 * Проверка порога звания стоит здесь не для полноты: именно она была сломана —
 * сравнение шло с числом 30 при рангах 1…4, поэтому маршрут отвечал 403 всем,
 * включая владельца сообщества. Такую ошибку глазами не видно, а тестом видно.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/socketEmit", () => ({ emitToUser: vi.fn() }));

import { getServerSession } from "next-auth";
import { emitToUser } from "@/lib/socketEmit";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);

function request(body: unknown) {
  return new Request("http://localhost/api/voice/move-user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BODY = { targetUserId: "u2", targetChannelId: "ch2", groupId: "g1" };

/** Канал-цель: голосовой и в том же сообществе. */
function mockChannel() {
  prismaMock.channel.findUnique.mockResolvedValue(row({ groupId: "g1", name: "Совет", type: "VOICE" }));
}

/** Звания участников: сначала спрашивают вызывающего, потом цель. */
function mockRanks(callerRole: string | null, targetRole: string | null) {
  prismaMock.groupMember.findUnique
    .mockResolvedValueOnce(callerRole ? row({ role: callerRole, guidedUntil: null }) : row(null))
    .mockResolvedValueOnce(targetRole ? row({ role: targetRole, guidedUntil: null }) : row(null));
}

beforeEach(() => {
  vi.mocked(emitToUser).mockClear();
  mockSession.mockResolvedValue({ user: { id: "u1" } } as never);
});

describe("POST /api/voice/move-user", () => {
  it("без сессии → 401", async () => {
    mockSession.mockResolvedValue(null);
    const res = await POST(request(BODY));
    expect(res.status).toBe(401);
  });

  it("владелец переносит участника → 200 и событие цели", async () => {
    mockChannel();
    mockRanks("OWNER", "MEMBER");
    const res = await POST(request(BODY));
    expect(res.status).toBe(200);
    expect(emitToUser).toHaveBeenCalledWith("u2", "voice:force-join", {
      channelId: "ch2",
      channelName: "Совет",
    });
  });

  it("проводник переносит участника → 200", async () => {
    mockChannel();
    mockRanks("GUIDE", "MEMBER");
    const res = await POST(request(BODY));
    expect(res.status).toBe(200);
  });

  it("равный по званию → 403", async () => {
    mockChannel();
    mockRanks("MODERATOR", "MODERATOR");
    const res = await POST(request(BODY));
    expect(res.status).toBe(403);
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it("обычный участник переносить не может → 403", async () => {
    mockChannel();
    mockRanks("MEMBER", "MEMBER");
    const res = await POST(request(BODY));
    expect(res.status).toBe(403);
  });

  it("не участник сообщества → 403", async () => {
    mockChannel();
    mockRanks(null, "MEMBER");
    const res = await POST(request(BODY));
    expect(res.status).toBe(403);
  });

  it("канал не голосовой → 400", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row({ groupId: "g1", name: "Общий", type: "TEXT" }));
    const res = await POST(request(BODY));
    expect(res.status).toBe(400);
  });

  it("канал из другого сообщества → 400", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row({ groupId: "g2", name: "Совет", type: "VOICE" }));
    const res = await POST(request(BODY));
    expect(res.status).toBe(400);
  });
});
