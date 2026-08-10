/**
 * Тесты: GET/POST /api/groups/[id]/reports
 * Жизненный цикл: подача и просмотр жалоб участников сообщества.
 */
import { describe, it, expect, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/groupModeration", async () => {
  const actual = await import("@/lib/groupModeration");
  return actual;
});

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

function makeRequest(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const BASE_URL = "http://localhost/api/groups/g1/reports";

describe("GET /api/groups/[id]/reports", () => {
  it("возвращает 401 без сессии", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/groups/[id]/reports/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(401);
  });

  it("обычный участник (MEMBER) не видит жалобы — 403", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    const { GET } = await import("@/app/api/groups/[id]/reports/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(403);
  });

  it("не-участник группы не видит жалобы — 403", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "outsider", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/groups/[id]/reports/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(403);
  });

  it("модератор видит жалобы группы", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod1", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MODERATOR" } as never);
    prismaMock.groupReport.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/groups/[id]/reports/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reports).toEqual([]);
  });

  it("администратор группы видит жалобы", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "ADMIN" } as never);
    prismaMock.groupReport.findMany.mockResolvedValue([{ id: "r1" }] as never);
    const { GET } = await import("@/app/api/groups/[id]/reports/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reports).toHaveLength(1);
  });

  it("фильтрация по статусу передаётся в запрос", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod1", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MODERATOR" } as never);
    prismaMock.groupReport.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/groups/[id]/reports/route");
    const res = await GET(makeRequest(`${BASE_URL}?status=PENDING`), makeParams("g1"));
    expect(res.status).toBe(200);
    expect(prismaMock.groupReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
      })
    );
  });
});

describe("POST /api/groups/[id]/reports", () => {
  it("возвращает 401 без сессии", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { POST } = await import("@/app/api/groups/[id]/reports/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { targetId: "u2" }), makeParams("g1"));
    expect(res.status).toBe(401);
  });

  it("возвращает 400 без targetId", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    const { POST } = await import("@/app/api/groups/[id]/reports/route");
    const res = await POST(makeRequest(BASE_URL, "POST", {}), makeParams("g1"));
    expect(res.status).toBe(400);
  });

  it("нельзя пожаловаться на себя — 400", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    const { POST } = await import("@/app/api/groups/[id]/reports/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { targetId: "user1" }), makeParams("g1"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/себя/i);
  });

  it("не-участник группы не может подать жалобу — 403", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "outsider", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue(null);
    const { POST } = await import("@/app/api/groups/[id]/reports/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { targetId: "u2" }), makeParams("g1"));
    expect(res.status).toBe(403);
  });

  it("участник группы успешно подаёт жалобу", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    prismaMock.groupReport.create.mockResolvedValue({ id: "rep1" } as never);
    const { POST } = await import("@/app/api/groups/[id]/reports/route");
    const res = await POST(
      makeRequest(BASE_URL, "POST", { targetId: "u2", reason: "spam" }),
      makeParams("g1")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toBe("rep1");
  });

  it("повторная жалоба (дубликат) возвращает ok=true duplicate=true", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    prismaMock.groupReport.create.mockRejectedValue(new Error("Unique constraint"));
    const { POST } = await import("@/app/api/groups/[id]/reports/route");
    const res = await POST(
      makeRequest(BASE_URL, "POST", { targetId: "u2", reason: "spam" }),
      makeParams("g1")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.duplicate).toBe(true);
  });

  it("жалоба с сообщением проверяет принадлежность сообщения группе", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    // Сообщение из другой группы
    prismaMock.message.findUnique.mockResolvedValue({
      content: "текст",
      userId: "u2",
      channelId: "ch1",
      channel: { groupId: "other-group" },
    } as never);
    const { POST } = await import("@/app/api/groups/[id]/reports/route");
    const res = await POST(
      makeRequest(BASE_URL, "POST", { targetId: "u2", messageId: "msg1" }),
      makeParams("g1")
    );
    expect(res.status).toBe(404);
  });

  it("жалоба с сообщением: targetId должен совпадать с автором сообщения", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    prismaMock.message.findUnique.mockResolvedValue({
      content: "текст",
      userId: "u3", // другой автор
      channelId: "ch1",
      channel: { groupId: "g1" },
    } as never);
    const { POST } = await import("@/app/api/groups/[id]/reports/route");
    const res = await POST(
      makeRequest(BASE_URL, "POST", { targetId: "u2", messageId: "msg1" }),
      makeParams("g1")
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/автор/i);
  });

  it("неизвестная причина нормализуется до 'other'", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    prismaMock.groupReport.create.mockResolvedValue({ id: "rep2" } as never);
    const { POST } = await import("@/app/api/groups/[id]/reports/route");
    await POST(
      makeRequest(BASE_URL, "POST", { targetId: "u2", reason: "unknown_reason" }),
      makeParams("g1")
    );
    const createArg = prismaMock.groupReport.create.mock.calls[0][0] as { data: { reason: string } };
    expect(createArg.data.reason).toBe("other");
  });
});
