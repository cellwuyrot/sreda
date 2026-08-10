/**
 * Тесты: GET /api/dm/[id] — кого пускать в переписку.
 *
 * Здесь проверяется одно, но самое опасное: право читать. Личная переписка —
 * только двое участников. Деловой разговор по обращению — ещё и администрация,
 * потому что очередь заявок общая. Ошибка в любую сторону дорогая: либо чужая
 * переписка становится читаемой, либо администратор не может ответить клиенту.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn().mockResolvedValue(null) }));
/* Очистка текста к правам доступа отношения не имеет, а тянет за собой
   sanitize-html. Подменяем, чтобы тест проверял ровно одно — кого пускают. */
vi.mock("@/lib/sanitize", () => ({ sanitizeText: (text: string) => text }));
vi.mock("@/lib/socketEmit", () => ({ emitToUser: vi.fn(), emitToUsers: vi.fn() }));
vi.mock("@/lib/createNotification", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotificationsBulk: vi.fn().mockResolvedValue(0),
}));

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

const URL_BASE = "http://localhost/api/dm/conv-1";

function makeRequest() {
  return new Request(URL_BASE) as unknown as import("next/server").NextRequest;
}

function makeParams(id = "conv-1") {
  return { params: Promise.resolve({ id }) };
}

/** Разговор в базе. Для делового клиент — user1, сторона администрации — user2. */
function conversation(kind: "PERSONAL" | "BUSINESS", over: Record<string, unknown> = {}) {
  return row({
    id: "conv-1",
    kind,
    user1Id: "client-1",
    user2Id: "admin-1",
    appealId: kind === "BUSINESS" ? "appeal-1" : null,
    handlerId: null,
    locked: false,
    ...over,
  });
}

/** Отправка сообщения. Возвращает статус и разобранное тело. */
async function post(body: unknown) {
  const { POST } = await import("@/app/api/dm/[id]/route");
  const req = new Request(URL_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
  const res = await POST(req, makeParams());
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  prismaMock.directMessage.findMany.mockResolvedValue([]);
});

describe("GET /api/dm/[id] — доступ", () => {
  it("без сессии — 401", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dm/[id]/route");
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it("несуществующий разговор — 404", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "client-1", role: "USER" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dm/[id]/route");
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it("участник личной переписки её читает", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "client-1", role: "USER" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("PERSONAL"));
    const { GET } = await import("@/app/api/dm/[id]/route");
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
  });

  /**
   * ИНВАРИАНТ: роль администратора НЕ открывает личную переписку. Право читать
   * личные сообщения не входит в полномочия администрации, и деловой раздел
   * такого права ей не приносит.
   */
  it("ИНВАРИАНТ: администратор не читает чужую личную переписку", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-9", role: "ADMIN" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("PERSONAL"));
    const { GET } = await import("@/app/api/dm/[id]/route");
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(403);
    expect(prismaMock.directMessage.findMany).not.toHaveBeenCalled();
  });

  it("администратор вне пары читает деловой разговор: очередь заявок общая", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-9", role: "ADMIN" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("BUSINESS"));
    const { GET } = await import("@/app/api/dm/[id]/route");
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
  });

  it("редактор вне пары тоже читает деловой разговор", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "editor-9", role: "EDITOR" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("BUSINESS"));
    const { GET } = await import("@/app/api/dm/[id]/route");
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
  });

  /**
   * ИНВАРИАНТ: посторонний в деловой разговор не попадает. Раздел общий для
   * администрации, а не для всех: иначе заявка одного клиента была бы видна
   * любому другому.
   */
  it("ИНВАРИАНТ: посторонний пользователь в деловой разговор не попадает", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "stranger", role: "USER" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("BUSINESS"));
    const { GET } = await import("@/app/api/dm/[id]/route");
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(403);
  });

  it("клиент читает свой деловой разговор", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "client-1", role: "USER" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("BUSINESS"));
    const { GET } = await import("@/app/api/dm/[id]/route");
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
  });
});

// ── BUSINESS-LOCK: закрытая отправка ───────────────────────────────────────

describe("POST /api/dm/[id] — закрытая отправка в деловом разговоре", () => {
  beforeEach(() => {
    prismaMock.dmUserSetting.findUnique.mockResolvedValue(null);
    prismaMock.directMessage.create.mockResolvedValue(
      row({ id: "m1", conversationId: "conv-1", userId: "admin-1", content: "текст", user: { id: "admin-1", name: "Админ" } }),
    );
    prismaMock.directConversation.update.mockResolvedValue(row({ id: "conv-1" }));
    prismaMock.user.findUnique.mockResolvedValue(row({ notifyPush: true, isPremium: false, role: "USER" }));
    prismaMock.appeal.findUnique.mockResolvedValue(null);
    /* Деловой разговор рассылает событие всей администрации: список берётся из
       базы (см. lib/businessChat), поэтому выборка сотрудников должна отвечать. */
    prismaMock.user.findMany.mockResolvedValue(row([{ id: "admin-1" }]));
  });

  /**
   * ИНВАРИАНТ И ЕСТЬ ПРИЧИНА ПРАВКИ: клиента в деловом разговоре нельзя было
   * остановить ничем. Чёрного списка здесь нет и быть не может (сторона —
   * администрация, а не человек), а закрытие заявки отправку не запрещало.
   */
  it("ИНВАРИАНТ: клиент при закрытой отправке получает отказ и ничего не пишет", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "client-1", role: "USER" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("BUSINESS", { locked: true }));
    const { status, body } = await post({ content: "ещё раз здравствуйте" });
    expect(status).toBe(403);
    expect(body.locked).toBe(true);
    expect(prismaMock.directMessage.create).not.toHaveBeenCalled();
  });

  /**
   * ИНВАРИАНТ: запрет односторонний. Администрация обязана иметь возможность
   * ответить и после закрытия — иначе последнее слово всегда остаётся за
   * клиентом, и закрывать отправку становится незачем.
   */
  it("ИНВАРИАНТ: администрация пишет и при закрытой отправке", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("BUSINESS", { locked: true }));
    const { status } = await post({ content: "разговор окончен" });
    expect(status).toBe(200);
    expect(prismaMock.directMessage.create).toHaveBeenCalled();
  });

  it("редактор — та же сторона администрации", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "editor-9", role: "EDITOR" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("BUSINESS", { locked: true }));
    expect((await post({ content: "по заявке" })).status).toBe(200);
  });

  it("открытый деловой разговор клиенту не мешает", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "client-1", role: "USER" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("BUSINESS", { locked: false }));
    expect((await post({ content: "вопрос" })).status).toBe(200);
  });

  /**
   * ИНВАРИАНТ: в личной переписке этого запрета нет. Там для того же есть чёрный
   * список, и он взаимный; односторонний запрет между двумя людьми был бы новым
   * видом власти одного над другим.
   */
  it("ИНВАРИАНТ: на личную переписку признак не действует", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "client-1", role: "USER" } } as never);
    prismaMock.directConversation.findUnique.mockResolvedValue(conversation("PERSONAL", { locked: true }));
    expect((await post({ content: "привет" })).status).toBe(200);
  });
});
