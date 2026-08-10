/**
 * Тесты: GET/PATCH /api/appeals/[id]
 * Жизненный цикл: просмотр апелляции, изменение статуса модератором.
 * КЛЮЧЕВАЯ ПРОВЕРКА: обычный участник (автор) не может закрыть собственную апелляцию.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const notifyAppealStatus = vi.fn();
vi.mock("@/lib/appealNotify", () => ({
  notifyAppealStatus: (...a: unknown[]) => notifyAppealStatus(...a),
  APPEAL_ENTITY: "appeal",
}));

/* Пометку о прочтении подменяем: проверять надо не её внутренности (для этого есть
   тесты lib/createNotification), а то, что открытие заявки её вызывает — и именно
   по этой заявке. */
const markSubjectNotificationsRead = vi.fn().mockResolvedValue({ marked: 1, unreadLeft: 4 });
vi.mock("@/lib/createNotification", () => ({
  markSubjectNotificationsRead: (...a: unknown[]) => markSubjectNotificationsRead(...a),
}));

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

beforeEach(() => {
  notifyAppealStatus.mockReset();
  markSubjectNotificationsRead.mockClear().mockResolvedValue({ marked: 1, unreadLeft: 4 });
});

function makeRequest(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as import("next/server").NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const BASE_URL = "http://localhost/api/appeals";

const mockAppeal = {
  id: "ap1",
  authorId: "user1",
  subject: "Тема",
  body: "Текст",
  status: "OPEN",
  author: { id: "user1", name: "User", username: "user1", avatar: null },
  channel: { id: "ch1", name: "Апелляции" },
  messages: [],
};

describe("GET /api/appeals/[id]", () => {
  it("возвращает 401 без сессии", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/appeals/[id]/route");
    const res = await GET(makeRequest(`${BASE_URL}/ap1`), makeParams("ap1"));
    expect(res.status).toBe(401);
  });

  it("возвращает 404 если апелляция не найдена", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/appeals/[id]/route");
    const res = await GET(makeRequest(`${BASE_URL}/ap99`), makeParams("ap99"));
    expect(res.status).toBe(404);
  });

  it("автор видит собственную апелляцию", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    const { GET } = await import("@/app/api/appeals/[id]/route");
    const res = await GET(makeRequest(`${BASE_URL}/ap1`), makeParams("ap1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.appeal.id).toBe("ap1");
    expect(json.isAdmin).toBe(false);
  });

  it("чужой пользователь не может просмотреть апелляцию другого — 403", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "other", role: "USER" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    const { GET } = await import("@/app/api/appeals/[id]/route");
    const res = await GET(makeRequest(`${BASE_URL}/ap1`), makeParams("ap1"));
    expect(res.status).toBe(403);
  });

  it("администратор видит апелляцию любого пользователя", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    const { GET } = await import("@/app/api/appeals/[id]/route");
    const res = await GET(makeRequest(`${BASE_URL}/ap1`), makeParams("ap1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.isAdmin).toBe(true);
  });
});

describe("PATCH /api/appeals/[id] — только для администраторов", () => {
  it("возвращает 401 без сессии", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/appeals/[id]/route");
    const res = await PATCH(makeRequest(`${BASE_URL}/ap1`, "PATCH", { status: "CLOSED" }), makeParams("ap1"));
    expect(res.status).toBe(401);
  });

  it("обычный участник (автор апелляции) не может изменить статус — 403", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    const { PATCH } = await import("@/app/api/appeals/[id]/route");
    const res = await PATCH(makeRequest(`${BASE_URL}/ap1`, "PATCH", { status: "CLOSED" }), makeParams("ap1"));
    expect(res.status).toBe(403);
  });

  /**
   * КЛЮЧЕВАЯ ПРОВЕРКА ДОГОВОРА:
   * Пользователь не может сам закрыть собственную апелляцию.
   * Маршрут PATCH требует роли ADMIN или EDITOR — USER получит 403.
   */
  it("КЛЮЧЕВОЙ ИНВАРИАНТ: автор апелляции не может закрыть её сам (USER → 403)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    const { PATCH } = await import("@/app/api/appeals/[id]/route");
    const res = await PATCH(
      makeRequest(`${BASE_URL}/ap1`, "PATCH", { status: "CLOSED" }),
      makeParams("ap1")
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });

  it("возвращает 400 при недопустимом статусе", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    const { PATCH } = await import("@/app/api/appeals/[id]/route");
    const res = await PATCH(makeRequest(`${BASE_URL}/ap1`, "PATCH", { status: "INVALID" }), makeParams("ap1"));
    expect(res.status).toBe(400);
  });

  it("администратор может закрыть апелляцию (CLOSED)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "CLOSED" } as never);
    notifyAppealStatus.mockResolvedValue(undefined);
    const { PATCH } = await import("@/app/api/appeals/[id]/route");
    const res = await PATCH(makeRequest(`${BASE_URL}/ap1`, "PATCH", { status: "CLOSED" }), makeParams("ap1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.appeal.status).toBe("CLOSED");
  });

  it("администратор может перевести апелляцию в IN_PROGRESS", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "IN_PROGRESS" } as never);
    notifyAppealStatus.mockResolvedValue(undefined);
    const { PATCH } = await import("@/app/api/appeals/[id]/route");
    const res = await PATCH(makeRequest(`${BASE_URL}/ap1`, "PATCH", { status: "IN_PROGRESS" }), makeParams("ap1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.appeal.status).toBe("IN_PROGRESS");
  });

  it("EDITOR (редактор) тоже может закрыть апелляцию", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "editor1", role: "EDITOR" } } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "CLOSED" } as never);
    notifyAppealStatus.mockResolvedValue(undefined);
    const { PATCH } = await import("@/app/api/appeals/[id]/route");
    const res = await PATCH(makeRequest(`${BASE_URL}/ap1`, "PATCH", { status: "CLOSED" }), makeParams("ap1"));
    expect(res.status).toBe(200);
  });

  it("смена статуса вызывает notifyAppealStatus с новым статусом", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "CLOSED" } as never);
    notifyAppealStatus.mockResolvedValue(undefined);
    const { PATCH } = await import("@/app/api/appeals/[id]/route");
    await PATCH(makeRequest(`${BASE_URL}/ap1`, "PATCH", { status: "CLOSED" }), makeParams("ap1"));
    expect(notifyAppealStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CLOSED" })
    );
  });

  it("сбой уведомления не ломает ответ маршрута — статус по-прежнему 200", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "CLOSED" } as never);
    notifyAppealStatus.mockRejectedValue(new Error("Ошибка уведомления"));
    const { PATCH } = await import("@/app/api/appeals/[id]/route");
    const res = await PATCH(makeRequest(`${BASE_URL}/ap1`, "PATCH", { status: "CLOSED" }), makeParams("ap1"));
    // статус обновлён, ошибка уведомления не ломает ответ
    expect(res.status).toBe(200);
  });
});

// ── «Перешёл, прочёл — и уведомление пропало» ──────────────────────────────

describe("GET /api/appeals/[id] — открытие гасит уведомления по заявке", () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(null as never);
  });

  /**
   * ИНВАРИАНТ И ЕСТЬ САМ БАГ: открыл заявку — уведомление о ней прочитано.
   * Раньше уведомление гасло ТОЛЬКО от нажатия на него в списке уведомлений,
   * поэтому обычный путь (перешёл в обращения, открыл карточку, прочитал)
   * оставлял его непрочитанным навсегда: ссылка ведёт в раздел, а не в заявку.
   */
  it("ИНВАРИАНТ: открытие заявки помечает её уведомления прочитанными", async () => {
    const { GET } = await import("@/app/api/appeals/[id]/route");
    const res = await GET(makeRequest(`${BASE_URL}/ap1`), makeParams("ap1"));
    expect(res.status).toBe(200);
    expect(markSubjectNotificationsRead).toHaveBeenCalledWith({
      userId: "admin1",
      entityType: "appeal",
      entityId: "ap1",
    });
  });

  it("в ответе есть остаток непрочитанного: колокольчик обновляется без второго запроса", async () => {
    const { GET } = await import("@/app/api/appeals/[id]/route");
    const res = await GET(makeRequest(`${BASE_URL}/ap1`), makeParams("ap1"));
    expect((await res.json()).unreadLeft).toBe(4);
  });

  /**
   * ИНВАРИАНТ: карточка важнее пометки. Упавшая пометка не должна лишать человека
   * самого обращения — иначе починка уведомлений сломала бы работу с заявками.
   */
  it("ИНВАРИАНТ: сбой пометки не ломает открытие заявки", async () => {
    markSubjectNotificationsRead.mockRejectedValue(new Error("база недоступна"));
    const { GET } = await import("@/app/api/appeals/[id]/route");
    const res = await GET(makeRequest(`${BASE_URL}/ap1`), makeParams("ap1"));
    expect(res.status).toBe(200);
    expect((await res.json()).appeal.id).toBe("ap1");
  });

  /**
   * ИНВАРИАНТ: без права на заявку ничего не гасится. Иначе перебором
   * идентификаторов можно было бы чистить чужие уведомления.
   */
  it("ИНВАРИАНТ: посторонний получает 403, и пометка не вызывается", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stranger", role: "USER" } } as never);
    const { GET } = await import("@/app/api/appeals/[id]/route");
    const res = await GET(makeRequest(`${BASE_URL}/ap1`), makeParams("ap1"));
    expect(res.status).toBe(403);
    expect(markSubjectNotificationsRead).not.toHaveBeenCalled();
  });

  it("несуществующая заявка — 404 и никакой пометки", async () => {
    prismaMock.appeal.findUnique.mockResolvedValue(null as never);
    const { GET } = await import("@/app/api/appeals/[id]/route");
    const res = await GET(makeRequest(`${BASE_URL}/nope`), makeParams("nope"));
    expect(res.status).toBe(404);
    expect(markSubjectNotificationsRead).not.toHaveBeenCalled();
  });
});
