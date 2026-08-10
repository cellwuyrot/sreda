/**
 * Тесты: GET/POST/DELETE /api/groups/[id]/censor
 * Словарь цензуры сообщества: права, подписка, добавление и удаление слов.
 */
import { describe, it, expect, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/groupAudit", () => ({ logGroupAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/censorService", () => ({
  censorCounters: vi.fn().mockResolvedValue([]),
  invalidateCensorCache: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { checkBan } from "@/lib/banCheck";

const mockSession = vi.mocked(getServerSession);
const mockCheckBan = vi.mocked(checkBan);

const BASE_URL = "http://localhost/api/groups/g1/censor";

function makeRequest(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Мок данных сообщества с владельцем */
function mockGroupWithPremium(premium: boolean, ownerRole = "USER") {
  prismaMock.group.findUnique.mockResolvedValue(
    row({ id: "g1", owner: { isPremium: premium, role: ownerRole } })
  );
}

// ─────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────
describe("GET /api/groups/[id]/censor", () => {
  it("без сессии → 401", async () => {
    mockSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/groups/[id]/censor/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(401);
  });

  it("не-участник сообщества → 403", async () => {
    mockSession.mockResolvedValue({ user: { id: "u1" } } as never);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/groups/[id]/censor/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(403);
  });

  it("MODERATOR → 403 (словарь — правило места, не мера модерации)", async () => {
    mockSession.mockResolvedValue({ user: { id: "mod1" } } as never);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "MODERATOR" }));
    const { GET } = await import("@/app/api/groups/[id]/censor/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(403);
  });

  it("у владельца нет Premium → 200 с available: false (не 403)", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1" } } as never);
    mockGroupWithPremium(false);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    const { GET } = await import("@/app/api/groups/[id]/censor/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.available).toBe(false);
    expect(json.words).toEqual([]);
    expect(json.counters).toEqual([]);
  });

  it("ADMIN сообщества с Premium → 200 со словарём", async () => {
    mockSession.mockResolvedValue({ user: { id: "admin1" } } as never);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "ADMIN" }));
    prismaMock.groupCensorWord.findMany.mockResolvedValue(
      row([{ id: "w1", word: "дурак", level: "WATCH", createdAt: new Date() }])
    );
    const { GET } = await import("@/app/api/groups/[id]/censor/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.available).toBe(true);
    expect(json.words).toHaveLength(1);
  });

  it("OWNER сообщества с Premium → 200", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1" } } as never);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    prismaMock.groupCensorWord.findMany.mockResolvedValue(row([]));
    const { GET } = await import("@/app/api/groups/[id]/censor/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.available).toBe(true);
  });

  it("несуществующее сообщество → 404", async () => {
    mockSession.mockResolvedValue({ user: { id: "u1" } } as never);
    prismaMock.group.findUnique.mockResolvedValue(null);
    prismaMock.groupMember.findUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/groups/[id]/censor/route");
    const res = await GET(makeRequest(BASE_URL), makeParams("g1"));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// POST
// ─────────────────────────────────────────────────────────────
describe("POST /api/groups/[id]/censor", () => {
  it("без сессии → 401", async () => {
    mockSession.mockResolvedValue(null);
    const { POST } = await import("@/app/api/groups/[id]/censor/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { word: "дурак" }), makeParams("g1"));
    expect(res.status).toBe(401);
  });

  it("не-участник → 403", async () => {
    mockSession.mockResolvedValue({ user: { id: "u1", name: "User" } } as never);
    mockCheckBan.mockResolvedValue(null);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(null);
    const { POST } = await import("@/app/api/groups/[id]/censor/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { word: "дурак" }), makeParams("g1"));
    expect(res.status).toBe(403);
  });

  it("MODERATOR → 403", async () => {
    mockSession.mockResolvedValue({ user: { id: "mod1", name: "Mod" } } as never);
    mockCheckBan.mockResolvedValue(null);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "MODERATOR" }));
    const { POST } = await import("@/app/api/groups/[id]/censor/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { word: "дурак" }), makeParams("g1"));
    expect(res.status).toBe(403);
  });

  it("у владельца нет Premium → 403", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as never);
    mockCheckBan.mockResolvedValue(null);
    mockGroupWithPremium(false);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    const { POST } = await import("@/app/api/groups/[id]/censor/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { word: "дурак" }), makeParams("g1"));
    expect(res.status).toBe(403);
  });

  it("некорректное слово → 400 с сообщением из normalizeCensorWordInput", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as never);
    mockCheckBan.mockResolvedValue(null);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    const { POST } = await import("@/app/api/groups/[id]/censor/route");
    // Одна буква — слишком коротко
    const res = await POST(makeRequest(BASE_URL, "POST", { word: "а" }), makeParams("g1"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(typeof json.error).toBe("string");
    expect(json.error.length).toBeGreaterThan(0);
  });

  it("без указания уровня ставит WATCH по умолчанию", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as never);
    mockCheckBan.mockResolvedValue(null);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    prismaMock.groupCensorWord.count.mockResolvedValue(0);
    prismaMock.groupCensorWord.findFirst.mockResolvedValue(null);
    prismaMock.groupCensorWord.create.mockResolvedValue(
      row({ id: "w1", word: "дурак", level: "WATCH", createdAt: new Date() })
    );
    const { POST } = await import("@/app/api/groups/[id]/censor/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { word: "дурак" }), makeParams("g1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.word.level).toBe("WATCH");
  });

  it("уже существующее слово → меняет уровень, replaced: true, без создания новой записи", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as never);
    mockCheckBan.mockResolvedValue(null);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    prismaMock.groupCensorWord.count.mockResolvedValue(1);
    prismaMock.groupCensorWord.findFirst.mockResolvedValue(
      row({ id: "w1", level: "WATCH" })
    );
    prismaMock.groupCensorWord.update.mockResolvedValue(
      row({ id: "w1", word: "дурак", level: "BLOCK", createdAt: new Date() })
    );
    const { POST } = await import("@/app/api/groups/[id]/censor/route");
    const res = await POST(
      makeRequest(BASE_URL, "POST", { word: "дурак", level: "BLOCK" }),
      makeParams("g1")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.replaced).toBe(true);
    expect(json.word.level).toBe("BLOCK");
    expect(prismaMock.groupCensorWord.create).not.toHaveBeenCalled();
  });

  it("достигнут лимит словаря → 400", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as never);
    mockCheckBan.mockResolvedValue(null);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    prismaMock.groupCensorWord.count.mockResolvedValue(300); // CENSOR_DICTIONARY_MAX = 300
    const { POST } = await import("@/app/api/groups/[id]/censor/route");
    const res = await POST(
      makeRequest(BASE_URL, "POST", { word: "дурак" }),
      makeParams("g1")
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/300/);
  });

  it("POST без тела не падает с 500 — обрабатывает как ошибку валидации 400", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as never);
    mockCheckBan.mockResolvedValue(null);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    const req = new Request(BASE_URL, { method: "POST" });
    const { POST } = await import("@/app/api/groups/[id]/censor/route");
    const res = await POST(req, makeParams("g1"));
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────
describe("DELETE /api/groups/[id]/censor", () => {
  it("без сессии → 401", async () => {
    mockSession.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/groups/[id]/censor/route");
    const res = await DELETE(
      makeRequest(`${BASE_URL}?wordId=w1`, "DELETE"),
      makeParams("g1")
    );
    expect(res.status).toBe(401);
  });

  it("не-участник → 403", async () => {
    mockSession.mockResolvedValue({ user: { id: "u1" } } as never);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/groups/[id]/censor/route");
    const res = await DELETE(
      makeRequest(`${BASE_URL}?wordId=w1`, "DELETE"),
      makeParams("g1")
    );
    expect(res.status).toBe(403);
  });

  it("MODERATOR → 403", async () => {
    mockSession.mockResolvedValue({ user: { id: "mod1" } } as never);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "MODERATOR" }));
    const { DELETE } = await import("@/app/api/groups/[id]/censor/route");
    const res = await DELETE(
      makeRequest(`${BASE_URL}?wordId=w1`, "DELETE"),
      makeParams("g1")
    );
    expect(res.status).toBe(403);
  });

  it("без wordId → 400", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1" } } as never);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    const { DELETE } = await import("@/app/api/groups/[id]/censor/route");
    const res = await DELETE(makeRequest(BASE_URL, "DELETE"), makeParams("g1"));
    expect(res.status).toBe(400);
  });

  it("wordId из другого сообщества → 404", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1" } } as never);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    // findFirst вернул null — слово не принадлежит этому сообществу
    prismaMock.groupCensorWord.findFirst.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/groups/[id]/censor/route");
    const res = await DELETE(
      makeRequest(`${BASE_URL}?wordId=foreign-word-id`, "DELETE"),
      makeParams("g1")
    );
    expect(res.status).toBe(404);
  });

  it("успешное удаление → 200 с success: true", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner1", name: "Owner" } } as never);
    mockGroupWithPremium(true);
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    prismaMock.groupCensorWord.findFirst.mockResolvedValue(row({ id: "w1", word: "дурак" }));
    prismaMock.groupCensorWord.delete.mockResolvedValue(row({ id: "w1" }));
    const { DELETE } = await import("@/app/api/groups/[id]/censor/route");
    const res = await DELETE(
      makeRequest(`${BASE_URL}?wordId=w1`, "DELETE"),
      makeParams("g1")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
