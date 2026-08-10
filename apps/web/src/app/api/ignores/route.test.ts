/**
 * Тесты: GET/POST/DELETE /api/ignores (UserIgnore)
 * КЛЮЧЕВАЯ ПРОВЕРКА: свой игнор-лист виден только владельцу — чужой не может
 * получить список игнорируемых другого пользователя через этот маршрут.
 */
import { describe, it, expect, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

function makeRequest(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const BASE_URL = "http://localhost/api/ignores";

describe("GET /api/ignores — только для владельца", () => {
  it("возвращает 401 без сессии", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/ignores/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  /**
   * КЛЮЧЕВАЯ ПРОВЕРКА: маршрут всегда использует session.user.id как фильтр.
   * Нет параметра userId — нет способа запросить чужой список.
   * Игнор-лист виден только его владельцу.
   */
  it("возвращает только собственный список игнорируемых (нет параметра для чужого)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.userIgnore.findMany.mockResolvedValue([
      {
        ignoredId: "u2",
        createdAt: new Date(),
        ignored: { id: "u2", name: "User2", username: "user2", avatar: null },
      },
    ] as never);
    const { GET } = await import("@/app/api/ignores/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toEqual(["u2"]);
    // Проверяем, что запрос идёт строго по userId из сессии
    expect(prismaMock.userIgnore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user1" } })
    );
  });

  it("возвращает пустой список если никого не игнорируют", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.userIgnore.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/ignores/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toEqual([]);
    expect(json.users).toEqual([]);
  });
});

describe("POST /api/ignores", () => {
  it("возвращает 401 без сессии", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { POST } = await import("@/app/api/ignores/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { userId: "u2" }));
    expect(res.status).toBe(401);
  });

  it("возвращает 400 без userId", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    const { POST } = await import("@/app/api/ignores/route");
    const res = await POST(makeRequest(BASE_URL, "POST", {}));
    expect(res.status).toBe(400);
  });

  it("нельзя добавить себя в игнор — 400", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    const { POST } = await import("@/app/api/ignores/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { userId: "user1" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/себя/i);
  });

  it("возвращает 404 если игнорируемый пользователь не найден", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.user.findUnique.mockResolvedValue(null);
    const { POST } = await import("@/app/api/ignores/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { userId: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("успешно добавляет пользователя в игнор", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.user.findUnique.mockResolvedValue({ id: "u2" } as never);
    prismaMock.userIgnore.upsert.mockResolvedValue({} as never);
    const { POST } = await import("@/app/api/ignores/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { userId: "u2" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    // upsert использует session.user.id как userId
    expect(prismaMock.userIgnore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_ignoredId: { userId: "user1", ignoredId: "u2" } },
        create: { userId: "user1", ignoredId: "u2" },
      })
    );
  });

  it("повторный вызов (уже в игноре) тоже возвращает ok=true (upsert идемпотентен)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.user.findUnique.mockResolvedValue({ id: "u2" } as never);
    prismaMock.userIgnore.upsert.mockResolvedValue({} as never);
    const { POST } = await import("@/app/api/ignores/route");
    const res = await POST(makeRequest(BASE_URL, "POST", { userId: "u2" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});

describe("DELETE /api/ignores", () => {
  it("возвращает 401 без сессии", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/ignores/route");
    const res = await DELETE(makeRequest(`${BASE_URL}?userId=u2`, "DELETE"));
    expect(res.status).toBe(401);
  });

  it("возвращает 400 без параметра userId", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    const { DELETE } = await import("@/app/api/ignores/route");
    const res = await DELETE(makeRequest(BASE_URL, "DELETE"));
    expect(res.status).toBe(400);
  });

  it("успешно снимает игнор", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.userIgnore.deleteMany.mockResolvedValue({ count: 1 } as never);
    const { DELETE } = await import("@/app/api/ignores/route");
    const res = await DELETE(makeRequest(`${BASE_URL}?userId=u2`, "DELETE"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    // deleteMany фильтрует строго по session.user.id
    expect(prismaMock.userIgnore.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user1", ignoredId: "u2" } })
    );
  });
});
