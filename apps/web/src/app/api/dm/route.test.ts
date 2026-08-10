/**
 * Тесты: GET/POST /api/dm
 */
import { describe, it, expect, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";
import { row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/activity", () => ({ freshActivity: vi.fn().mockReturnValue(null) }));

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

const DM_URL = "http://localhost/api/dm";

// ─── GET /api/dm ───────────────────────────────────────────────────────────────

describe("GET /api/dm", () => {
  it("без сессии возвращает 401", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dm/route");
    const res = await GET(new Request(DM_URL));
    expect(res.status).toBe(401);
  });

  it("по умолчанию ищет только PERSONAL диалоги", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue([]);

    const { GET } = await import("@/app/api/dm/route");
    await GET(new Request(DM_URL));

    expect(prismaMock.directConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: "PERSONAL" }),
      })
    );
  });

  it("?kind=business ставит kind=BUSINESS в запрос к базе", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue([]);

    const { GET } = await import("@/app/api/dm/route");
    await GET(new Request(`${DM_URL}?kind=business`));

    expect(prismaMock.directConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: "BUSINESS" }),
      })
    );
  });

  it("мусорное значение ?kind=что-то откатывается на PERSONAL", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue([]);

    const { GET } = await import("@/app/api/dm/route");
    await GET(new Request(`${DM_URL}?kind=%D1%87%D1%82%D0%BE-%D1%82%D0%BE`));

    expect(prismaMock.directConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: "PERSONAL" }),
      })
    );
  });

  it("успешный запрос возвращает 200 и массив", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } } as never);

    const fakeConv = {
      id: "conv-1",
      user1Id: "u1",
      user2Id: "u2",
      lastMessageAt: new Date(),
      user1: {
        id: "u1",
        name: "One",
        username: "one",
        avatar: null,
        role: "USER",
        lastSeen: null,
        customStatus: null,
        statusEmoji: null,
        activityStatus: null,
        activityUpdatedAt: null,
        avatarGlowEnabled: false,
        avatarGlowColors: [],
      },
      user2: {
        id: "u2",
        name: "Two",
        username: "two",
        avatar: null,
        role: "USER",
        lastSeen: null,
        customStatus: null,
        statusEmoji: null,
        activityStatus: null,
        activityUpdatedAt: null,
        avatarGlowEnabled: false,
        avatarGlowColors: [],
      },
      messages: [],
    };
    prismaMock.directConversation.findMany.mockResolvedValue(row([fakeConv]));

    const { GET } = await import("@/app/api/dm/route");
    const res = await GET(new Request(DM_URL));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json[0].id).toBe("conv-1");
  });
});

// ─── POST /api/dm ──────────────────────────────────────────────────────────────

describe("POST /api/dm", () => {
  it("без сессии возвращает 401", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { POST } = await import("@/app/api/dm/route");
    const req = new Request(DM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "someone" }),
    }) as unknown as import("next/server").NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("без username и userId возвращает 400", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } } as never);
    const { POST } = await import("@/app/api/dm/route");
    const req = new Request(DM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }) as unknown as import("next/server").NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("пользователь не найден → 404", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } } as never);
    prismaMock.user.findUnique.mockResolvedValue(null);
    const { POST } = await import("@/app/api/dm/route");
    const req = new Request(DM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "ghost" }),
    }) as unknown as import("next/server").NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("нет дружбы → 403", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } } as never);
    prismaMock.user.findUnique.mockResolvedValue(row({ id: "u2", username: "two" }));
    prismaMock.friendship.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/dm/route");
    const req = new Request(DM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "two" }),
    }) as unknown as import("next/server").NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  /* Составного ключа [user1, user2, kind] в схеме больше нет: он не давал
     создать второй деловой чат тому же клиенту. Личную переписку ищем обычным
     запросом, а уникальность пары держит частичный индекс в базе. */
  it("ищет личную переписку по паре и виду, без составного ключа", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-a" } } as never);
    prismaMock.user.findUnique.mockResolvedValue(row({ id: "user-b", username: "userb" }));
    prismaMock.friendship.findFirst.mockResolvedValue(row({ id: "fr1" }));
    prismaMock.dmUserSetting.findFirst.mockResolvedValue(null);
    prismaMock.directConversation.findFirst.mockResolvedValue(
      row({ id: "conv-1", user1Id: "user-a", user2Id: "user-b", kind: "PERSONAL" })
    );

    const { POST } = await import("@/app/api/dm/route");
    const req = new Request(DM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "userb" }),
    }) as unknown as import("next/server").NextRequest;
    await POST(req);

    expect(prismaMock.directConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user1Id: "user-a", user2Id: "user-b", kind: "PERSONAL" },
      })
    );
    expect(prismaMock.directConversation.create).not.toHaveBeenCalled();
  });

  it("создаёт новый диалог с kind=PERSONAL если не найден", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-a" } } as never);
    prismaMock.user.findUnique.mockResolvedValue(row({ id: "user-b", username: "userb" }));
    prismaMock.friendship.findFirst.mockResolvedValue(row({ id: "fr1" }));
    prismaMock.dmUserSetting.findFirst.mockResolvedValue(null);
    prismaMock.directConversation.findFirst.mockResolvedValue(null);
    prismaMock.directConversation.create.mockResolvedValue(
      row({ id: "conv-new", user1Id: "user-a", user2Id: "user-b", kind: "PERSONAL" })
    );

    const { POST } = await import("@/app/api/dm/route");
    const req = new Request(DM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "userb" }),
    }) as unknown as import("next/server").NextRequest;
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(prismaMock.directConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "PERSONAL" }),
      })
    );
  });
});

// ─── Деловой раздел: связка клиент ↔ администрация ────────────────────────────

/** Один деловой разговор: клиент — user1, сторона администрации — user2. */
function businessRow(handler: { id: string; name: string } | null) {
  return row([
    {
      id: "conv-b1",
      kind: "BUSINESS",
      user1Id: "client-1",
      user2Id: "admin-1",
      appealId: "appeal-1",
      handlerId: handler?.id ?? null,
      handler,
      lastMessageAt: null,
      user1: {
        id: "client-1",
        name: "Клиент Пётр",
        username: "petr",
        avatar: null,
        role: "USER",
        lastSeen: null,
        customStatus: null,
        statusEmoji: null,
        avatarGlowEnabled: false,
        avatarGlowColors: null,
      },
      user2: {
        id: "admin-1",
        name: "Админ",
        username: "admin",
        avatar: null,
        role: "ADMIN",
        lastSeen: null,
        customStatus: null,
        statusEmoji: null,
        avatarGlowEnabled: false,
        avatarGlowColors: null,
      },
      messages: [],
    },
  ]);
}

describe("GET /api/dm?kind=business", () => {
  /**
   * ИНВАРИАНТ: очередь заявок у администрации общая. Администратор и редактор
   * видят ВСЕ деловые разговоры, а не только те, где стоят в паре, — иначе
   * заявка, доставшаяся отсутствующему человеку, недоступна остальным.
   */
  it("ИНВАРИАНТ: администратор видит всю очередь, а не только свои разговоры", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-9", role: "ADMIN" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue(businessRow(null));
    prismaMock.appeal.findMany.mockResolvedValue(
      row([{ id: "appeal-1", subject: "Сотрудничество", status: "OPEN" }])
    );

    const { GET } = await import("@/app/api/dm/route");
    await GET(new Request(`${DM_URL}?kind=business`));

    expect(prismaMock.directConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: "BUSINESS" } })
    );
  });

  it("редактор — тоже администрация: очередь целиком", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "editor-9", role: "EDITOR" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue(businessRow(null));
    prismaMock.appeal.findMany.mockResolvedValue(row([]));

    const { GET } = await import("@/app/api/dm/route");
    await GET(new Request(`${DM_URL}?kind=business`));

    expect(prismaMock.directConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: "BUSINESS" } })
    );
  });

  it("клиенту отдаются только его разговоры", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "client-1", role: "USER" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue(businessRow(null));
    prismaMock.appeal.findMany.mockResolvedValue(row([]));

    const { GET } = await import("@/app/api/dm/route");
    await GET(new Request(`${DM_URL}?kind=business`));

    expect(prismaMock.directConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ user1Id: "client-1" }, { user2Id: "client-1" }],
        }),
      })
    );
  });

  /**
   * ИНВАРИАНТ: клиент разговаривает с администрацией, а не с человеком. Имя
   * сотрудника ему не показывается: передача заявки другому не должна выглядеть
   * сменой собеседника, и незачем адресовать претензии конкретному человеку.
   */
  it("ИНВАРИАНТ: клиент видит «Администрация», а не имя сотрудника", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "client-1", role: "USER" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue(businessRow({ id: "admin-1", name: "Админ" }));
    prismaMock.appeal.findMany.mockResolvedValue(
      row([{ id: "appeal-1", subject: "Сотрудничество", status: "OPEN" }])
    );

    const { GET } = await import("@/app/api/dm/route");
    const res = await GET(new Request(`${DM_URL}?kind=business`));
    const data = (await res.json()) as Array<{
      other: { name: string; avatar: string | null };
      business: { party: string; subject: string; handlerName: string | null };
    }>;

    expect(data[0].other.name).toBe("Администрация TZ Connect");
    expect(data[0].other.name).not.toContain("Админ ");
    expect(data[0].business.party).toBe("client");
    expect(data[0].business.subject).toBe("Сотрудничество");
  });

  it("администрация видит клиента и того, кто ведёт разговор", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-9", role: "ADMIN" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue(businessRow({ id: "admin-1", name: "Админ" }));
    prismaMock.appeal.findMany.mockResolvedValue(
      row([{ id: "appeal-1", subject: "Сотрудничество", status: "IN_PROGRESS" }])
    );

    const { GET } = await import("@/app/api/dm/route");
    const res = await GET(new Request(`${DM_URL}?kind=business`));
    const data = (await res.json()) as Array<{
      other: { id: string; name: string };
      business: { party: string; clientName: string; handlerName: string | null };
    }>;

    expect(data[0].other.name).toBe("Клиент Пётр");
    expect(data[0].business.party).toBe("handler");
    expect(data[0].business.clientName).toBe("Клиент Пётр");
    expect(data[0].business.handlerName).toBe("Админ");
  });

  it("никем не взятая заявка отдаётся с пустым ведущим — это состояние очереди", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-9", role: "ADMIN" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue(businessRow(null));
    prismaMock.appeal.findMany.mockResolvedValue(row([]));

    const { GET } = await import("@/app/api/dm/route");
    const res = await GET(new Request(`${DM_URL}?kind=business`));
    const data = (await res.json()) as Array<{ business: { handlerName: string | null } }>;

    expect(data[0].business.handlerName).toBeNull();
  });

  it("темы обращений берутся одним запросом, а не по одному на разговор", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-9", role: "ADMIN" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue(businessRow(null));
    prismaMock.appeal.findMany.mockResolvedValue(row([]));

    const { GET } = await import("@/app/api/dm/route");
    await GET(new Request(`${DM_URL}?kind=business`));

    expect(prismaMock.appeal.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.appeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["appeal-1"] } } })
    );
  });

  it("в личной переписке связки с обращением нет вовсе", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
    prismaMock.directConversation.findMany.mockResolvedValue(
      row([
        {
          id: "conv-p1",
          kind: "PERSONAL",
          user1Id: "u1",
          user2Id: "u2",
          appealId: null,
          handlerId: null,
          handler: null,
          lastMessageAt: null,
          user1: { id: "u1", name: "Я", username: "me", avatar: null, role: "USER", lastSeen: null, customStatus: null, statusEmoji: null, avatarGlowEnabled: false, avatarGlowColors: null },
          user2: { id: "u2", name: "Друг", username: "friend", avatar: null, role: "USER", lastSeen: null, customStatus: null, statusEmoji: null, avatarGlowEnabled: false, avatarGlowColors: null },
          messages: [],
        },
      ])
    );

    const { GET } = await import("@/app/api/dm/route");
    const res = await GET(new Request(DM_URL));
    const data = (await res.json()) as Array<{ other: { name: string }; business?: unknown }>;

    expect(data[0].other.name).toBe("Друг");
    expect(data[0].business).toBeUndefined();
    expect(prismaMock.appeal.findMany).not.toHaveBeenCalled();
  });
});
