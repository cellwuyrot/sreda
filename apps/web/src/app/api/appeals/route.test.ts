/**
 * Тесты: GET/POST /api/appeals
 * Жизненный цикл: подача обращения и получение списка.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mainCommunity", () => ({ ensureAppealsChannel: vi.fn() }));

const notifyNewAppeal = vi.fn();
vi.mock("@/lib/appealNotify", () => ({
  notifyNewAppeal: (...a: unknown[]) => notifyNewAppeal(...a),
}));

/* CHAT: создание делового чата проверяется в lib/businessChat.test.ts. Здесь
   маршрут: заводит ли он разговор в момент ПОДАЧИ заявки. Разбор категории
   оставляем настоящий — от него зависит, кому чат положен. */
const ensureBusinessChat = vi.fn();
vi.mock("@/lib/businessChat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/businessChat")>();
  return { ...actual, ensureBusinessChat: (...a: unknown[]) => ensureBusinessChat(...a) };
});

/* ANTISPAM: сами правила проверяются в lib/appealLimits.test.ts. Здесь маршрут:
   спросил ли он разрешение и что делает с отказом. */
const checkAppealLimits = vi.fn();
vi.mock("@/lib/appealLimits", () => ({
  checkAppealLimits: (...a: unknown[]) => checkAppealLimits(...a),
}));

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

beforeEach(() => {
  notifyNewAppeal.mockReset();
  ensureBusinessChat.mockReset().mockResolvedValue("conv-1");
  checkAppealLimits.mockReset();
  // По умолчанию отправлять можно — иначе каждый тест начинался бы с отказа.
  checkAppealLimits.mockResolvedValue({ error: null });
});

function makeRequest(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as import("next/server").NextRequest;
}

const APPEALS_URL = "http://localhost/api/appeals";

describe("GET /api/appeals", () => {
  it("возвращает 401 для неаутентифицированного запроса", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/appeals/route");
    const res = await GET(makeRequest(APPEALS_URL));
    expect(res.status).toBe(401);
  });

  it("обычный участник получает только собственные обращения", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user1", role: "USER" },
    } as never);
    prismaMock.appeal.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/appeals/route");
    const res = await GET(makeRequest(APPEALS_URL));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.isAdmin).toBe(false);
    // authorId должен был быть передан в where
    expect(prismaMock.appeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ authorId: "user1" }) })
    );
  });

  it("администратор с scope=admin получает все обращения (без фильтра по authorId)", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "admin1", role: "ADMIN" },
    } as never);
    prismaMock.appeal.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/appeals/route");
    const res = await GET(makeRequest(`${APPEALS_URL}?scope=admin`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.isAdmin).toBe(true);
    const callArg = prismaMock.appeal.findMany.mock.calls[0][0] as { where?: Record<string, unknown> };
    expect(callArg.where).not.toHaveProperty("authorId");
  });

  it("обычный участник не может использовать scope=admin", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user1", role: "USER" },
    } as never);
    prismaMock.appeal.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/appeals/route");
    const res = await GET(makeRequest(`${APPEALS_URL}?scope=admin`));
    expect(res.status).toBe(200);
    const callArg = prismaMock.appeal.findMany.mock.calls[0][0] as { where?: Record<string, unknown> };
    // без прав scope=admin игнорируется, authorId остаётся в where
    expect(callArg.where).toHaveProperty("authorId", "user1");
  });

  it("banStatus=1 возвращает статус апелляции на бан для заблокированного", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "banned1", role: "USER" },
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({ banned: true } as never);
    prismaMock.auditLog.findFirst.mockResolvedValue({
      id: "log1",
      createdAt: new Date("2024-01-01"),
    } as never);
    prismaMock.appeal.count.mockResolvedValue(0);
    const { GET } = await import("@/app/api/appeals/route");
    const res = await GET(makeRequest(`${APPEALS_URL}?banStatus=1`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.banAppeal).toBeDefined();
    expect(json.banAppeal.allowed).toBe(true);
    expect(json.banAppeal.remaining).toBe(2);
  });

  it("banStatus=1 для незаблокированного возвращает allowed=false", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user2", role: "USER" },
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({ banned: false } as never);
    const { GET } = await import("@/app/api/appeals/route");
    const res = await GET(makeRequest(`${APPEALS_URL}?banStatus=1`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.banAppeal.allowed).toBe(false);
  });
});

describe("POST /api/appeals", () => {
  it("возвращает 401 без сессии", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { POST } = await import("@/app/api/appeals/route");
    const res = await POST(makeRequest(APPEALS_URL, "POST", { subject: "test", body: "test" }));
    expect(res.status).toBe(401);
  });

  it("возвращает 400 при пустой теме или тексте", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    const { POST } = await import("@/app/api/appeals/route");
    const res = await POST(makeRequest(APPEALS_URL, "POST", { subject: "", body: "text" }));
    expect(res.status).toBe(400);
  });

  it("возвращает 400 если тема слишком длинная", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    const { POST } = await import("@/app/api/appeals/route");
    const longSubject = "a".repeat(121);
    const res = await POST(makeRequest(APPEALS_URL, "POST", { subject: longSubject, body: "text" }));
    expect(res.status).toBe(400);
  });

  it("возвращает 503 если нет канала апелляций", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    prismaMock.channel.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/appeals/route");
    const res = await POST(makeRequest(APPEALS_URL, "POST", { subject: "Тема", body: "Текст" }));
    expect(res.status).toBe(503);
  });

  it("участник успешно подаёт обращение", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER", name: "User" } } as never);
    prismaMock.channel.findFirst.mockResolvedValue({ id: "ch1", type: "APPEALS" } as never);
    prismaMock.appeal.create.mockResolvedValue({
      id: "ap1",
      channelId: "ch1",
      authorId: "u1",
      subject: "Тема",
      body: "Текст",
      status: "OPEN",
      author: { id: "u1", name: "User", username: "user1", avatar: null },
      _count: { messages: 1 },
    } as never);
    notifyNewAppeal.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/appeals/route");
    const res = await POST(makeRequest(APPEALS_URL, "POST", { subject: "Тема", body: "Текст" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.appeal).toBeDefined();
    expect(json.appeal.status).toBe("OPEN");
  });

  it("BAN_APPEAL: возвращает 403 если пользователь не заблокирован", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    prismaMock.user.findUnique.mockResolvedValue({ banned: false } as never);
    const { POST } = await import("@/app/api/appeals/route");
    const res = await POST(makeRequest(APPEALS_URL, "POST", {
      subject: "Разблокируйте",
      body: "Прошу",
      category: "BAN_APPEAL",
    }));
    expect(res.status).toBe(403);
  });

  it("BAN_APPEAL: возвращает 429 если лимит обжалований исчерпан", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    prismaMock.user.findUnique.mockResolvedValue({ banned: true } as never);
    prismaMock.auditLog.findFirst.mockResolvedValue({ id: "log1", createdAt: new Date() } as never);
    // Использовано 2 из 2 попыток
    prismaMock.appeal.count.mockResolvedValue(2);
    const { POST } = await import("@/app/api/appeals/route");
    const res = await POST(makeRequest(APPEALS_URL, "POST", {
      subject: "Разблокируйте",
      body: "Прошу ещё раз",
      category: "BAN_APPEAL",
    }));
    expect(res.status).toBe(429);
  });

  it("BAN_APPEAL: заблокированный пользователь успешно подаёт апелляцию", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "banned1", role: "USER", name: "Banned" } } as never);
    prismaMock.user.findUnique.mockResolvedValue({ banned: true } as never);
    prismaMock.auditLog.findFirst.mockResolvedValue({ id: "log1", createdAt: new Date("2024-01-01") } as never);
    prismaMock.appeal.count.mockResolvedValue(0);
    prismaMock.channel.findFirst.mockResolvedValue({ id: "ch1", type: "APPEALS" } as never);
    prismaMock.appeal.create.mockResolvedValue({
      id: "ap2",
      channelId: "ch1",
      authorId: "banned1",
      subject: "Разблокируйте",
      body: "Прошу",
      status: "OPEN",
      author: { id: "banned1", name: "Banned", username: "banned1", avatar: null },
      _count: { messages: 1 },
    } as never);
    notifyNewAppeal.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/appeals/route");
    const res = await POST(makeRequest(APPEALS_URL, "POST", {
      subject: "Разблокируйте",
      body: "Прошу",
      category: "BAN_APPEAL",
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.appeal.status).toBe("OPEN");
    expect(json.banAppeal).toBeDefined();
  });

  it("создание обращения вызывает notifyNewAppeal с actorId отправителя, темой и признаком isBanAppeal", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER", name: "User One" } } as never);
    prismaMock.channel.findFirst.mockResolvedValue({ id: "ch1", type: "APPEALS" } as never);
    prismaMock.appeal.create.mockResolvedValue({
      id: "ap1",
      channelId: "ch1",
      authorId: "u1",
      subject: "Моё обращение",
      body: "Текст",
      status: "OPEN",
      author: { id: "u1", name: "User One", username: "userone", avatar: null },
      _count: { messages: 1 },
    } as never);
    notifyNewAppeal.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/appeals/route");
    await POST(makeRequest(APPEALS_URL, "POST", { subject: "Моё обращение", body: "Текст" }));
    expect(notifyNewAppeal).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "u1",
        subject: "Моё обращение",
        isBanAppeal: false,
      })
    );
  });

  it("создание BAN_APPEAL вызывает notifyNewAppeal с isBanAppeal=true", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "banned1", role: "USER", name: "Banned" } } as never);
    prismaMock.user.findUnique.mockResolvedValue({ banned: true } as never);
    prismaMock.auditLog.findFirst.mockResolvedValue({ id: "log1", createdAt: new Date("2024-01-01") } as never);
    prismaMock.appeal.count.mockResolvedValue(0);
    prismaMock.channel.findFirst.mockResolvedValue({ id: "ch1", type: "APPEALS" } as never);
    prismaMock.appeal.create.mockResolvedValue({
      id: "ap2",
      channelId: "ch1",
      authorId: "banned1",
      subject: "Разблокируйте",
      body: "Прошу",
      status: "OPEN",
      author: { id: "banned1", name: "Banned", username: "banned1", avatar: null },
      _count: { messages: 1 },
    } as never);
    notifyNewAppeal.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/appeals/route");
    await POST(makeRequest(APPEALS_URL, "POST", {
      subject: "Разблокируйте",
      body: "Прошу",
      category: "BAN_APPEAL",
    }));
    expect(notifyNewAppeal).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "banned1", isBanAppeal: true })
    );
  });
});

describe("POST /api/appeals — антиспам", () => {
  it("отказывает с 429 и заголовком Retry-After, когда правило сработало", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    checkAppealLimits.mockResolvedValue({ error: "Слишком часто", retryAfterSec: 120 });

    const { POST } = await import("@/app/api/appeals/route");
    const res = await POST(makeRequest("http://localhost/api/appeals", "POST", {
      subject: "Сотрудничество: ИИ", body: "текст", category: "COOPERATION",
    }) as never);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    const data = await res.json();
    expect(data.error).toBe("Слишком часто");
    // Обращение при отказе не создаётся.
    expect(prismaMock.appeal.create).not.toHaveBeenCalled();
  });

  it("обжалование блокировки правила антиспама не проверяет", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    prismaMock.user.findUnique.mockResolvedValue(row({ banned: false }));

    const { POST } = await import("@/app/api/appeals/route");
    await POST(makeRequest("http://localhost/api/appeals", "POST", {
      subject: "Обжалование", body: "текст", category: "BAN_APPEAL",
    }) as never);

    /* У обжалования свой предел (две попытки на бан). Пропустить его через общий
       антиспам значило бы наказать человека дважды за одно. */
    expect(checkAppealLimits).not.toHaveBeenCalled();
  });
});

// ─── Деловой чат заводится при подаче ─────────────────────────────────────────

describe("POST /api/appeals — деловой чат", () => {
  /** Обычная подготовка успешной подачи. */
  function ready(category?: string) {
    mockGetServerSession.mockResolvedValue({ user: { id: "client-1", role: "USER", name: "Клиент" } } as never);
    prismaMock.channel.findFirst.mockResolvedValue({ id: "ch1", type: "APPEALS" } as never);
    prismaMock.appeal.create.mockResolvedValue({
      id: "ap-1",
      channelId: "ch1",
      authorId: "client-1",
      subject: "Сотрудничество",
      body: "Хочу продвигать продукт",
      category: category ?? "",
      status: "OPEN",
      author: { id: "client-1", name: "Клиент", username: "client", avatar: null },
      _count: { messages: 1 },
    } as never);
    notifyNewAppeal.mockResolvedValue(undefined);
  }

  /**
   * ИНВАРИАНТ: чат появляется в момент подачи, а не после первого ответа.
   * Человек только что описал задачу и пойдёт искать разговор там, где ему его
   * обещали; не найдя, отправит заявку заново.
   */
  it("ИНВАРИАНТ: заявка на сотрудничество открывает чат сразу при подаче", async () => {
    ready("COOPERATION");

    const { POST } = await import("@/app/api/appeals/route");
    const res = await POST(
      makeRequest(APPEALS_URL, "POST", {
        subject: "Сотрудничество",
        body: "Хочу продвигать продукт",
        category: "COOPERATION",
      })
    );

    expect(res.status).toBe(201);
    expect(ensureBusinessChat).toHaveBeenCalledWith(
      expect.objectContaining({
        appealId: "ap-1",
        clientId: "client-1",
        subject: "Сотрудничество",
        appealBody: "Хочу продвигать продукт",
      })
    );
  });

  it("обычное обращение чата не получает", async () => {
    ready("GENERAL");

    const { POST } = await import("@/app/api/appeals/route");
    await POST(makeRequest(APPEALS_URL, "POST", { subject: "Вопрос", body: "Текст", category: "GENERAL" }));

    expect(ensureBusinessChat).not.toHaveBeenCalled();
  });

  /**
   * ИНВАРИАНТ: сбой создания чата не роняет приём обращения. Иначе человек
   * решит, что заявка не ушла, и отправит её снова — а она уже принята.
   */
  it("ИНВАРИАНТ: упавшее создание чата не срывает подачу заявки", async () => {
    ready("COOPERATION");
    ensureBusinessChat.mockRejectedValue(new Error("база недоступна"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { POST } = await import("@/app/api/appeals/route");
    const res = await POST(
      makeRequest(APPEALS_URL, "POST", {
        subject: "Сотрудничество",
        body: "Текст",
        category: "COOPERATION",
      })
    );

    expect(res.status).toBe(201);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("текст заявки уходит в уведомление — по нему решают, не заходя в админку", async () => {
    ready("COOPERATION");

    const { POST } = await import("@/app/api/appeals/route");
    await POST(
      makeRequest(APPEALS_URL, "POST", {
        subject: "Сотрудничество",
        body: "Хочу продвигать продукт",
        category: "COOPERATION",
      })
    );

    expect(notifyNewAppeal).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Хочу продвигать продукт" })
    );
  });
});
