/**
 * Тесты: POST /api/appeals/[id]/messages
 * Подача ответа на апелляцию; автоматическое продвижение статуса.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const notifyAppealReply = vi.fn();
vi.mock("@/lib/appealNotify", () => ({
  notifyAppealReply: (...a: unknown[]) => notifyAppealReply(...a),
}));

/* CHAT: перенос ответа в деловой чат проверяется в lib/businessChat.test.ts.
   Здесь — договор маршрута: он зовёт перенос и отдаёт id разговора клиенту. */
const mirrorAppealMessage = vi.fn();
vi.mock("@/lib/businessChat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/businessChat")>();
  return { ...actual, mirrorAppealMessage: (...a: unknown[]) => mirrorAppealMessage(...a) };
});

const emitToUser = vi.fn();
vi.mock("@/lib/socketEmit", () => ({
  emitToUser: (...a: unknown[]) => emitToUser(...a),
  emitToUsers: vi.fn(),
}));

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

beforeEach(() => {
  notifyAppealReply.mockReset();
  mirrorAppealMessage.mockReset().mockResolvedValue(null);
  emitToUser.mockReset();
});

function makeRequest(url: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as import("next/server").NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const BASE_URL = "http://localhost/api/appeals/ap1/messages";

const mockAppeal = {
  id: "ap1",
  authorId: "user1",
  subject: "Тема",
  status: "OPEN",
};

const mockMessage = {
  id: "msg1",
  appealId: "ap1",
  authorId: "user1",
  body: "Добавляю информацию",
  isAdmin: false,
  author: { id: "user1", name: "User", username: "user1", avatar: null },
};

describe("POST /api/appeals/[id]/messages", () => {
  it("возвращает 401 без сессии", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "текст" }), makeParams("ap1"));
    expect(res.status).toBe(401);
  });

  it("возвращает 400 при пустом теле сообщения", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "" }), makeParams("ap1"));
    expect(res.status).toBe(400);
  });

  it("возвращает 404 если апелляция не существует", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(null);
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "текст" }), makeParams("ap1"));
    expect(res.status).toBe(404);
  });

  it("чужой пользователь не может ответить на апелляцию — 403", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "other", role: "USER" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "текст" }), makeParams("ap1"));
    expect(res.status).toBe(403);
  });

  it("автор апелляции может добавить сообщение", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue(mockMessage as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "OPEN" } as never);
    notifyAppealReply.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "Добавляю информацию" }), makeParams("ap1"));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.message.isAdmin).toBe(false);
    // статус не меняется при ответе обычного участника
    expect(json.status).toBe("OPEN");
  });

  it("ответ администратора переводит апелляцию OPEN → IN_PROGRESS", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue({
      ...mockMessage,
      authorId: "admin1",
      isAdmin: true,
      author: { id: "admin1", name: "Admin", username: "admin1", avatar: null },
    } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "IN_PROGRESS" } as never);
    notifyAppealReply.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "Рассматриваем вашу апелляцию" }), makeParams("ap1"));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.message.isAdmin).toBe(true);
    expect(json.status).toBe("IN_PROGRESS");
  });

  it("ответ администратора на уже не-OPEN апелляцию не меняет статус", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue({ ...mockAppeal, status: "IN_PROGRESS" } as never);
    prismaMock.appealMessage.create.mockResolvedValue({
      ...mockMessage,
      authorId: "admin1",
      isAdmin: true,
      author: { id: "admin1", name: "Admin", username: "admin1", avatar: null },
    } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "IN_PROGRESS" } as never);
    notifyAppealReply.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "Второй ответ" }), makeParams("ap1"));
    expect(res.status).toBe(201);
    const json = await res.json();
    // статус остаётся IN_PROGRESS, не OPEN
    expect(json.status).toBe("IN_PROGRESS");
  });

  it("EDITOR может отвечать на апелляцию (флаг isAdmin=true)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "editor1", role: "EDITOR" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue({
      ...mockMessage,
      authorId: "editor1",
      isAdmin: true,
      author: { id: "editor1", name: "Editor", username: "editor1", avatar: null },
    } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "IN_PROGRESS" } as never);
    notifyAppealReply.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "Ответ редактора" }), makeParams("ap1"));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.message.isAdmin).toBe(true);
  });

  it("ответ администратора вызывает notifyAppealReply с fromAdmin: true", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue({
      ...mockMessage,
      authorId: "admin1",
      isAdmin: true,
      author: { id: "admin1", name: "Admin", username: "admin1", avatar: null },
    } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "IN_PROGRESS" } as never);
    notifyAppealReply.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    await POST(makeRequest(BASE_URL, { body: "Ответ" }), makeParams("ap1"));
    expect(notifyAppealReply).toHaveBeenCalledWith(
      expect.objectContaining({ fromAdmin: true })
    );
  });

  it("ответ автора вызывает notifyAppealReply с fromAdmin: false", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue(mockMessage as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "OPEN" } as never);
    notifyAppealReply.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    await POST(makeRequest(BASE_URL, { body: "Дополнение" }), makeParams("ap1"));
    expect(notifyAppealReply).toHaveBeenCalledWith(
      expect.objectContaining({ fromAdmin: false })
    );
  });

  it("сбой уведомления не ломает ответ маршрута — статус по-прежнему 201", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(mockAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue({
      ...mockMessage,
      authorId: "admin1",
      isAdmin: true,
      author: { id: "admin1", name: "Admin", username: "admin1", avatar: null },
    } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...mockAppeal, status: "IN_PROGRESS" } as never);
    notifyAppealReply.mockRejectedValue(new Error("Ошибка уведомления"));
    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "Ответ" }), makeParams("ap1"));
    // ответ записан успешно, несмотря на ошибку уведомления
    expect(res.status).toBe(201);
  });
});

// ─── Связка с деловым чатом ───────────────────────────────────────────────────

describe("POST /api/appeals/[id]/messages — деловой чат", () => {
  const coopAppeal = {
    id: "ap1",
    authorId: "client-1",
    subject: "Сотрудничество",
    body: "Текст заявки",
    category: "COOPERATION",
    status: "OPEN",
  };

  function mirrored(handlerId: string | null) {
    mirrorAppealMessage.mockResolvedValue({
      conversationId: "conv-1",
      handlerId,
      recipients: ["client-1", "admin-1", "editor-1"],
      message: {
        id: "dm-1",
        content: "Готовы обсудить",
        userId: "admin-1",
        conversationId: "conv-1",
        createdAt: new Date("2026-08-01T10:00:00Z"),
        user: { id: "admin-1", name: "Админ", username: "admin", avatar: null, role: "ADMIN" },
      },
    });
  }

  it("ответ администратора переносится в чат, id разговора возвращается клиенту", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(coopAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue({ ...mockMessage, isAdmin: true } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...coopAppeal, status: "IN_PROGRESS" } as never);
    notifyAppealReply.mockResolvedValue(undefined);
    mirrored("admin-1");

    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "Готовы обсудить" }), makeParams("ap1"));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.conversationId).toBe("conv-1");
    expect(mirrorAppealMessage).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: "admin-1", body: "Готовы обсудить", fromStaff: true })
    );
  });

  it("событие о сообщении уходит всем адресатам: клиенту и администрации", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(coopAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue({ ...mockMessage, isAdmin: true } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...coopAppeal, status: "IN_PROGRESS" } as never);
    notifyAppealReply.mockResolvedValue(undefined);
    mirrored("admin-1");

    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    await POST(makeRequest(BASE_URL, { body: "Готовы обсудить" }), makeParams("ap1"));

    expect(emitToUser).toHaveBeenCalledTimes(3);
    expect(emitToUser.mock.calls.map((c) => c[0])).toEqual(["client-1", "admin-1", "editor-1"]);
  });

  /**
   * ИНВАРИАНТ: тост о сообщении поднимает уведомление, а не это событие. Иначе
   * на один ответ человек получает два всплывающих окна.
   */
  it("ИНВАРИАНТ: событие не просит показывать нативный тост", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(coopAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue({ ...mockMessage, isAdmin: true } as never);
    prismaMock.appeal.update.mockResolvedValue({ ...coopAppeal, status: "IN_PROGRESS" } as never);
    notifyAppealReply.mockResolvedValue(undefined);
    mirrored("admin-1");

    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    await POST(makeRequest(BASE_URL, { body: "Готовы обсудить" }), makeParams("ap1"));

    const payload = emitToUser.mock.calls[0][2] as { pushEnabled: boolean };
    expect(payload.pushEnabled).toBe(false);
  });

  it("дописка клиента тоже попадает в чат, но заявку он не берёт", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "client-1", role: "USER" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(coopAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue(mockMessage as never);
    prismaMock.appeal.update.mockResolvedValue(coopAppeal as never);
    notifyAppealReply.mockResolvedValue(undefined);
    mirrored(null);

    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    await POST(makeRequest(BASE_URL, { body: "Дополню" }), makeParams("ap1"));

    expect(mirrorAppealMessage).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: "client-1", fromStaff: false })
    );
  });

  /**
   * ИНВАРИАНТ: сбой переноса в чат не роняет ответ. Ответ уже записан в
   * обращение, и терять его из-за чата нельзя.
   */
  it("ИНВАРИАНТ: упавший перенос в чат не ломает ответ", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as never);
    prismaMock.appeal.findUnique.mockResolvedValue(coopAppeal as never);
    prismaMock.appealMessage.create.mockResolvedValue({ ...mockMessage, isAdmin: true } as never);
    prismaMock.appeal.update.mockResolvedValue(coopAppeal as never);
    notifyAppealReply.mockResolvedValue(undefined);
    mirrorAppealMessage.mockRejectedValue(new Error("база недоступна"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { POST } = await import("@/app/api/appeals/[id]/messages/route");
    const res = await POST(makeRequest(BASE_URL, { body: "Ответ" }), makeParams("ap1"));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.conversationId).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
