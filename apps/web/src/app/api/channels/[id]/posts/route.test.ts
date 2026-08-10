/**
 * Тесты: /api/channels/[id]/posts — лента новостей канала.
 *
 * Проверяется то, ради чего лента затевалась, и то, чем она может навредить:
 *
 *   • чужой черновик и не наступившая публикация не должны попасть в выдачу;
 *   • комментарии не должны всплывать в ленте как самостоятельные посты;
 *   • закреплённый пост обязан быть первым, но не обязан повторяться на
 *     каждой странице;
 *   • публиковать может только модерация, и только с обложкой из хранилища;
 *   • черновик никого не уведомляет, обычная публикация — уведомляет.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn(async () => null) }));
vi.mock("@/lib/connectPermissions", () => ({ getChannelPermissions: vi.fn() }));
vi.mock("@/lib/createNotification", () => ({
  createNotificationsBulk: vi.fn(async () => 1),
  deleteSubjectNotifications: vi.fn(async () => 0),
}));

import { getServerSession } from "next-auth";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { createNotificationsBulk } from "@/lib/createNotification";

const mockSession = vi.mocked(getServerSession);
const mockPermissions = vi.mocked(getChannelPermissions);
const mockBulk = vi.mocked(createNotificationsBulk);

const HOUR = 60 * 60 * 1000;

/** Права на канал: по умолчанию — модератор новостного канала. */
function permissions(over: Record<string, unknown> = {}) {
  return {
    channelId: "ch1",
    groupId: "g1",
    channelType: "NEWS",
    role: "MODERATOR",
    isMember: true,
    canView: true,
    canPost: true,
    canComment: true,
    canModerate: true,
    canManage: false,
    denialReason: null,
    ...over,
  } as never;
}

/** Строка поста в том виде, в каком её отдаёт prisma маршруту. */
function postRow(over: Record<string, unknown> = {}) {
  return row({
    id: "p1",
    title: "Заголовок",
    content: "Текст",
    cover: null,
    attachments: null,
    pinned: false,
    views: 0,
    commentsClosed: false,
    draft: false,
    publishAt: null,
    announcedAt: null,
    editedAt: null,
    createdAt: new Date("2026-09-09T10:00:00.000Z"),
    userId: "mod",
    channelId: "ch1",
    threadId: null,
    user: { id: "mod", name: "Мод", username: "mod", avatar: null },
    reactions: [],
    _count: { threadReplies: 0 },
    ...over,
  });
}

async function callGet(url = "http://localhost/api/channels/ch1/posts") {
  const mod = await import("@/app/api/channels/[id]/posts/route");
  const res = await mod.GET(new Request(url) as never, { params: Promise.resolve({ id: "ch1" }) });
  return { status: res.status, body: await res.json() };
}

async function callPost(body: unknown) {
  const mod = await import("@/app/api/channels/[id]/posts/route");
  const request = new Request("http://localhost/api/channels/ch1/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
  const res = await mod.POST(request, { params: Promise.resolve({ id: "ch1" }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "mod", role: "USER" } } as never);
  mockPermissions.mockResolvedValue(permissions());
  mockBulk.mockClear();
  mockBulk.mockResolvedValue(1);

  prismaMock.message.findMany.mockResolvedValue([]);
  prismaMock.message.create.mockResolvedValue(postRow());
  // Рассылка уведомления: заявка на announcedAt и список получателей.
  prismaMock.message.findUnique.mockResolvedValue(
    postRow({
      channel: {
        id: "ch1",
        groupId: "g1",
        name: "новости",
        hidden: false,
        isRestricted: false,
        readAccess: "ALL",
        group: { paused: false },
        allowedRoles: [],
      },
    }),
  );
  prismaMock.message.updateMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.groupMember.findMany.mockResolvedValue([
    row({ userId: "reader", role: "MEMBER", muted: false, tags: [] }),
  ]);
  prismaMock.channelMute.findMany.mockResolvedValue([]);
});

// ── Кто вообще видит ленту ───────────────────────────────────────────────────

describe("доступ к ленте", () => {
  it("без входа — 401", async () => {
    mockSession.mockResolvedValue(null);
    expect((await callGet()).status).toBe(401);
  });

  it("нет права читать канал — 403 с понятной причиной", async () => {
    mockPermissions.mockResolvedValue(permissions({ canView: false, denialReason: "У вас нет доступа к этому каналу" }));
    const res = await callGet();
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("У вас нет доступа к этому каналу");
  });

  it("канала нет — 404", async () => {
    mockPermissions.mockResolvedValue(null);
    expect((await callGet()).status).toBe(404);
  });

  it("ФИКСАЦИЯ: обычный канал лентой не притворяется", async () => {
    /* Иначе клиент получил бы список реплик, оформленных как посты: без
       заголовков, обложек и просмотров. */
    mockPermissions.mockResolvedValue(permissions({ channelType: "TEXT" }));
    expect((await callGet()).status).toBe(400);
  });
});

// ── Что попадает в выдачу ────────────────────────────────────────────────────

describe("состав ленты", () => {
  it("ИНВАРИАНТ: чужие черновики и неопубликованное не отдаются", async () => {
    /* Условие уходит в сам запрос: отсеивай мы после выборки — страница из
       двадцати постов иногда возвращала бы пятнадцать. Своё видно всегда, и
       только своё. */
    await callGet();
    const where = prismaMock.message.findMany.mock.calls[0]![0]!.where as {
      OR: [{ userId: string }, { draft: boolean; OR: unknown[] }];
    };
    expect(where.OR[0]).toEqual({ userId: "mod" });
    expect(where.OR[1].draft).toBe(false);
  });

  it("ИНВАРИАНТ: комментарии в ленту не попадают", async () => {
    /* Комментарий — сообщение с threadId. Без этого условия обсуждение
       вываливалось бы в ленту отдельными постами без заголовка. */
    await callGet();
    for (const call of prismaMock.message.findMany.mock.calls) {
      expect((call[0]!.where as { threadId: null }).threadId).toBeNull();
    }
  });

  it("ИНВАРИАНТ: закреплённый пост первый, даже если он самый старый", async () => {
    /* Ради этого закрепление и существует. */
    prismaMock.message.findMany
      .mockResolvedValueOnce([postRow({ id: "pinned", pinned: true, createdAt: new Date("2025-01-01T00:00:00.000Z") })])
      .mockResolvedValueOnce([
        postRow({ id: "fresh", createdAt: new Date("2026-09-09T12:00:00.000Z") }),
        postRow({ id: "old", createdAt: new Date("2026-09-08T12:00:00.000Z") }),
      ]);
    const res = await callGet();
    expect(res.body.posts.map((post: { id: string }) => post.id)).toEqual(["pinned", "fresh", "old"]);
  });

  it("ИНВАРИАНТ: со второй страницы закреплённые не повторяются", async () => {
    /* Курсор идёт по дате; тащи мы закреплённые тем же запросом — старое
       закрепление возвращалось бы на КАЖДОЙ странице. */
    prismaMock.message.findMany.mockResolvedValue([]);
    await callGet("http://localhost/api/channels/ch1/posts?cursor=2026-09-09T10:00:00.000Z");
    expect(prismaMock.message.findMany).toHaveBeenCalledTimes(1);
    const where = prismaMock.message.findMany.mock.calls[0]![0]!.where as { pinned: boolean; createdAt: { lt: Date } };
    expect(where.pinned).toBe(false);
    expect(where.createdAt.lt.toISOString()).toBe("2026-09-09T10:00:00.000Z");
  });

  it("ФИКСАЦИЯ: мусорный курсор возвращает первую страницу, а не пустоту", async () => {
    /* new Date("вчера") — невалидная дата; молча отдать не тот кусок ленты
       хуже, чем начать сначала. */
    await callGet("http://localhost/api/channels/ch1/posts?cursor=вчера");
    expect(prismaMock.message.findMany).toHaveBeenCalledTimes(2); // закреплённые + остальное
  });

  it("следующий курсор появляется только когда есть что листать", async () => {
    prismaMock.message.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      postRow({ id: "a", createdAt: new Date("2026-09-09T12:00:00.000Z") }),
    ]);
    expect((await callGet("http://localhost/api/channels/ch1/posts?limit=1")).body.nextCursor).toBeNull();

    prismaMock.message.findMany.mockReset();
    prismaMock.message.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      postRow({ id: "a", createdAt: new Date("2026-09-09T12:00:00.000Z") }),
      postRow({ id: "b", createdAt: new Date("2026-09-09T11:00:00.000Z") }),
    ]);
    const res = await callGet("http://localhost/api/channels/ch1/posts?limit=1");
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.nextCursor).toBe("2026-09-09T12:00:00.000Z");
  });

  it("читателю сообщается, может ли он публиковать", async () => {
    mockPermissions.mockResolvedValue(permissions({ canPost: false, canModerate: false, role: "MEMBER" }));
    expect((await callGet()).body.canPost).toBe(false);
  });
});

// ── Публикация ───────────────────────────────────────────────────────────────

describe("публикация поста", () => {
  it("модератор публикует", async () => {
    const res = await callPost({ title: "Открытие", content: "Завтра в 10:00" });
    expect(res.status).toBe(200);
    expect(res.body.post.id).toBe("p1");
    expect(prismaMock.message.create).toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: обычный участник постов не создаёт", async () => {
    /* Право писать в новости было и остаётся у модерации; послабление
       касается только комментариев. */
    mockPermissions.mockResolvedValue(permissions({ canPost: false, canModerate: false, role: "MEMBER" }));
    const res = await callPost({ content: "я тоже хочу" });
    expect(res.status).toBe(403);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: обложка с чужого сервера не сохраняется", async () => {
    /* Иначе каждый, кто пролистал ленту, отдал бы чужому серверу свой адрес. */
    const res = await callPost({ content: "текст", cover: "https://evil.tld/pixel.png" });
    expect(res.status).toBe(400);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: вложение только из хранилища", async () => {
    const res = await callPost({ content: "текст", attachments: [{ url: "https://evil.tld/a.pdf" }] });
    expect(res.status).toBe(400);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("пустой пост не создаётся", async () => {
    expect((await callPost({ content: "   " })).status).toBe(400);
  });

  it("ФИКСАЦИЯ: пост из одного заголовка допустим", async () => {
    /* Объявление в одну строку — обычное дело; требовать «тело» незачем. */
    expect((await callPost({ title: "Сегодня выходной" })).status).toBe(200);
  });

  it("ИНВАРИАНТ: черновик никого не уведомляет", async () => {
    /* Уведомление о том, чего ещё нет: посторонние черновик не видят. */
    prismaMock.message.create.mockResolvedValue(postRow({ draft: true }));
    await callPost({ content: "черновик", draft: true });
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: отложенный пост уведомляет не сразу", async () => {
    /* Иначе новость приходит раньше, чем появляется. О ней расскажет обход
       отложенных публикаций в server.ts, когда наступит срок. */
    const publishAt = new Date(Date.now() + HOUR);
    prismaMock.message.create.mockResolvedValue(postRow({ publishAt }));
    await callPost({ content: "потом", publishAt: publishAt.toISOString() });
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it("обычная публикация уведомляет читателей канала", async () => {
    await callPost({ content: "новость" });
    expect(mockBulk).toHaveBeenCalledTimes(1);
    const args = mockBulk.mock.calls[0]![0];
    expect(args.userIds).toEqual(["reader"]);
    expect(args.entityType).toBe("news_post");
  });

  it("ИНВАРИАНТ: отметка о рассылке ставится ДО отправки", async () => {
    /* При обратном порядке сбой рассылки означал бы уведомление каждые
       полминуты, пока его не починят. */
    await callPost({ content: "новость" });
    const claim = prismaMock.message.updateMany.mock.calls[0]![0] as {
      where: { announcedAt: null };
      data: { announcedAt: Date };
    };
    expect(claim.where.announcedAt).toBeNull();
    expect(claim.data.announcedAt).toBeInstanceOf(Date);
  });

  it("ИНВАРИАНТ: отметку забрал другой процесс — второй рассылки нет", async () => {
    /* Обход в server.ts крутится на каждом инстансе; заявку выигрывает один. */
    prismaMock.message.updateMany.mockResolvedValue({ count: 0 } as never);
    await callPost({ content: "новость" });
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it("ФИКСАЦИЯ: сбой рассылки не отменяет публикацию", async () => {
    /* Пост уже создан — падать после этого поздно, человек решит, что
       публикация не прошла, и напишет её второй раз. */
    mockBulk.mockRejectedValue(new Error("почта лежит"));
    const res = await callPost({ content: "новость" });
    expect(res.status).toBe(200);
  });

  it("некорректное время публикации отклоняется", async () => {
    expect((await callPost({ content: "текст", publishAt: "завтра утром" })).status).toBe(400);
  });
});
