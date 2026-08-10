/**
 * Тесты: PATCH /api/groups/[id]/reports/[reportId]
 * Жизненный цикл: решение модератора по жалобе.
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
vi.mock("@/lib/groupAudit", () => ({
  logGroupAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/banCheck", () => ({
  checkBan: vi.fn().mockResolvedValue(null),
}));

import { getServerSession } from "next-auth";
import { checkBan } from "@/lib/banCheck";

const mockGetServerSession = vi.mocked(getServerSession);
const mockCheckBan = vi.mocked(checkBan);

function makeRequest(url: string, body?: unknown) {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeParams(id: string, reportId: string) {
  return { params: Promise.resolve({ id, reportId }) };
}

const BASE_URL = "http://localhost/api/groups/g1/reports/r1";

const mockReport = {
  id: "r1",
  groupId: "g1",
  reporterId: "user1",
  targetId: "user2",
  reason: "spam",
  status: "PENDING",
  excerpt: null,
  target: { id: "user2", name: "User2", username: "user2" },
};

describe("PATCH /api/groups/[id]/reports/[reportId]", () => {
  it("возвращает 401 без сессии", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/groups/[id]/reports/[reportId]/route");
    const res = await PATCH(makeRequest(BASE_URL, { status: "RESOLVED" }), makeParams("g1", "r1"));
    expect(res.status).toBe(401);
  });

  it("заблокированный пользователь не может разбирать жалобы — 403", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "banned1", role: "USER" } } as never);
    mockCheckBan.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Заблокирован" }), { status: 403 }) as never
    );
    const { PATCH } = await import("@/app/api/groups/[id]/reports/[reportId]/route");
    const res = await PATCH(makeRequest(BASE_URL, { status: "RESOLVED" }), makeParams("g1", "r1"));
    expect(res.status).toBe(403);
  });

  it("возвращает 400 при недопустимом статусе", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod1", role: "USER" } } as never);
    mockCheckBan.mockResolvedValue(null);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MODERATOR" } as never);
    const { PATCH } = await import("@/app/api/groups/[id]/reports/[reportId]/route");
    const res = await PATCH(makeRequest(BASE_URL, { status: "CLOSED" }), makeParams("g1", "r1"));
    expect(res.status).toBe(400);
  });

  it("обычный участник (MEMBER) не может разобрать жалобу — 403", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    mockCheckBan.mockResolvedValue(null);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    const { PATCH } = await import("@/app/api/groups/[id]/reports/[reportId]/route");
    const res = await PATCH(makeRequest(BASE_URL, { status: "RESOLVED" }), makeParams("g1", "r1"));
    expect(res.status).toBe(403);
  });

  it("не-участник группы не может разобрать жалобу — 403", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "outsider", role: "USER" } } as never);
    mockCheckBan.mockResolvedValue(null);
    prismaMock.groupMember.findUnique.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/groups/[id]/reports/[reportId]/route");
    const res = await PATCH(makeRequest(BASE_URL, { status: "RESOLVED" }), makeParams("g1", "r1"));
    expect(res.status).toBe(403);
  });

  it("возвращает 404 если жалоба не найдена", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod1", role: "USER" } } as never);
    mockCheckBan.mockResolvedValue(null);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MODERATOR" } as never);
    prismaMock.groupReport.findUnique.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/groups/[id]/reports/[reportId]/route");
    const res = await PATCH(makeRequest(BASE_URL, { status: "RESOLVED" }), makeParams("g1", "r99"));
    expect(res.status).toBe(404);
  });

  it("возвращает 404 если жалоба принадлежит другой группе", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod1", role: "USER" } } as never);
    mockCheckBan.mockResolvedValue(null);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MODERATOR" } as never);
    prismaMock.groupReport.findUnique.mockResolvedValue({ ...mockReport, groupId: "other-group" } as never);
    const { PATCH } = await import("@/app/api/groups/[id]/reports/[reportId]/route");
    const res = await PATCH(makeRequest(BASE_URL, { status: "RESOLVED" }), makeParams("g1", "r1"));
    expect(res.status).toBe(404);
  });

  it("модератор успешно отклоняет жалобу (DISMISSED)", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "mod1", role: "USER", username: "mod1", name: "Mod" },
    } as never);
    mockCheckBan.mockResolvedValue(null);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MODERATOR" } as never);
    prismaMock.groupReport.findUnique.mockResolvedValue(mockReport as never);
    prismaMock.groupReport.update.mockResolvedValue({ ...mockReport, status: "DISMISSED" } as never);
    const { PATCH } = await import("@/app/api/groups/[id]/reports/[reportId]/route");
    const res = await PATCH(makeRequest(BASE_URL, { status: "DISMISSED" }), makeParams("g1", "r1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.report.status).toBe("DISMISSED");
  });

  it("модератор успешно закрывает жалобу (RESOLVED)", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "mod1", role: "USER", username: "mod1", name: "Mod" },
    } as never);
    mockCheckBan.mockResolvedValue(null);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MODERATOR" } as never);
    prismaMock.groupReport.findUnique.mockResolvedValue(mockReport as never);
    prismaMock.groupReport.update.mockResolvedValue({ ...mockReport, status: "RESOLVED" } as never);
    const { PATCH } = await import("@/app/api/groups/[id]/reports/[reportId]/route");
    const res = await PATCH(makeRequest(BASE_URL, { status: "RESOLVED" }), makeParams("g1", "r1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.report.status).toBe("RESOLVED");
  });

  it("при разборе жалобы создаётся запись аудита", async () => {
    const { logGroupAction } = await import("@/lib/groupAudit");
    const mockLogGroupAction = vi.mocked(logGroupAction);
    mockGetServerSession.mockResolvedValue({
      user: { id: "mod1", role: "USER", username: "mod1", name: "Mod" },
    } as never);
    mockCheckBan.mockResolvedValue(null);
    prismaMock.groupMember.findUnique.mockResolvedValue({ role: "MODERATOR" } as never);
    prismaMock.groupReport.findUnique.mockResolvedValue(mockReport as never);
    prismaMock.groupReport.update.mockResolvedValue({ ...mockReport, status: "RESOLVED" } as never);
    const { PATCH } = await import("@/app/api/groups/[id]/reports/[reportId]/route");
    await PATCH(makeRequest(BASE_URL, { status: "RESOLVED" }), makeParams("g1", "r1"));
    expect(mockLogGroupAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "report.resolve" })
    );
  });
});
