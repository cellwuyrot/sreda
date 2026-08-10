/**
 * Тесты: /api/posts/[id]/comments — обсуждение под постом.
 *
 * Главное здесь — послабление: в новостном канале комментировать может любой,
 * кто канал читает, хотя публиковать по-прежнему только модерация. Ровно
 * поэтому остальные проверки важны вдвойне — комментарий не должен стать
 * обходным путём для запретов, действующих в переписке:
 *
 *   • закрытое обсуждение закрыто для всех, включая модерацию;
 *   • черновик и не наступившая публикация не комментируются;
 *   • тайм-аут и словарь сообщества работают и здесь;
 *   • канал комментария берётся у поста, а не из тела запроса.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn(async () => null) }));
vi.mock("@/lib/connectPermissions", () => ({ getChannelPermissions: vi.fn() }));
vi.mock("@/lib/moderation", () => ({ getActiveTimeout: vi.fn(async () => null) }));
vi.mock("@/lib/censorService", () => ({
  checkCensor: vi.fn(async () => ({ matches: [], level: null, blocked: false })),
  recordCensorHits: vi.fn(async () => undefined),
}));
vi.mock("@/lib/createNotification", () => ({
  createNotificationsBulk: vi.fn(async () => 1),
  deleteSubjectNotifications: vi.fn(async () => 0),
}));

import { getServerSession } from "next-auth";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { getActiveTimeout } from "@/lib/moderation";
import { checkCensor } from "@/lib/censorService";

const mockSession = vi.mocked(getServerSession);
const mockPermissions = vi.mocked(getChannelPermissions);
const mockTimeout = vi.mocked(getActiveTimeout);
const mockCensor = vi.mocked(checkCensor);

/** По умолчанию — обычный участник: он и есть главный герой этого маршрута. */
function permissions(over: Record<string, unknown> = {}) {
  return {
    channelId: "ch1",
    groupId: "g1",
    channelType: "NEWS",
    role: "MEMBER",
    isMember: true,
    canView: true,
    canPost: false,
    canComment: true,
    canModerate: false,
    canManage: false,
    denialReason: null,
    ...over,
  } as never;
}

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
    announcedAt: new Date("2026-09-09T09:00:00.000Z"),
    editedAt: null,
    createdAt: new Date("2026-09-09T10:00:00.000Z"),
    userId: "author",
    channelId: "ch1",
    threadId: null,
    threadCount: 0,
    user: { id: "author", name: "Аня", username: "anya", avatar: null },
    reactions: [],
    _count: { threadReplies: 0 },
    ...over,
  });
}

function commentRow(over: Record<string, unknown> = {}) {
  return row({
    id: "c1",
    content: "Согласен",
    createdAt: new Date("2026-09-09T11:00:00.000Z"),
    editedAt: null,
    userId: "reader",
    user: { id: "reader", name: "Ваня", username: "vanya", avatar: null },
    ...over,
  });
}

async function callGet(url = "http://localhost/api/posts/p1/comments") {
  const mod = await import("@/app/api/posts/[id]/comments/route");
  const res = await mod.GET(new Request(url) as never, { params: Promise.resolve({ id: "p1" }) });
  return { status: res.status, body: await res.json() };
}

async function callPost(body: unknown) {
  const mod = await import("@/app/api/posts/[id]/comments/route");
  const request = new Request("http://localhost/api/posts/p1/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
  const res = await mod.POST(request, { params: Promise.resolve({ id: "p1" }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "reader", role: "USER" } } as never);
  mockPermissions.mockResolvedValue(permissions());
  mockTimeout.mockClear();
  mockTimeout.mockResolvedValue(null);
  mockCensor.mockClear();
  mockCensor.mockResolvedValue({ matches: [], level: null, blocked: false } as never);

  prismaMock.message.findUnique.mockResolvedValue(postRow());
  prismaMock.message.findMany.mockResolvedValue([commentRow()]);
  prismaMock.message.create.mockResolvedValue(commentRow());
  prismaMock.message.update.mockResolvedValue(postRow());
});

// ── Чтение обсуждения ────────────────────────────────────────────────────────

describe("чтение комментариев", () => {
  it("без входа — 401", async () => {
    mockSession.mockResolvedValue(null);
    expect((await callGet()).status).toBe(401);
  });

  it("отдаёт комментарии поста и право отвечать", async () => {
    const res = await callGet();
    expect(res.status).toBe(200);
    expect(res.body.comments[0]).toMatchObject({ id: "c1", author: { username: "vanya" } });
    expect(res.body.canComment).toBe(true);
  });

  it("ИНВАРИАНТ: берутся комментарии именно этого поста", async () => {
    /* Без привязки к ветке в обсуждение попала бы вся переписка канала. */
    await callGet();
    const where = prismaMock.message.findMany.mock.calls[0]![0]!.where as { threadId: string };
    expect(where.threadId).toBe("p1");
  });

  it("у поста с закрытым обсуждением право отвечать снято", async () => {
    prismaMock.message.findUnique.mockResolvedValue(postRow({ commentsClosed: true }));
    expect((await callGet()).body.canComment).toBe(false);
  });

  it("ИНВАРИАНТ: чужой черновик не отдаёт даже своё обсуждение", async () => {
    prismaMock.message.findUnique.mockResolvedValue(postRow({ draft: true }));
    expect((await callGet()).status).toBe(404);
  });
});

// ── Отправка комментария ─────────────────────────────────────────────────────

describe("отправка комментария", () => {
  it("ИНВАРИАНТ: обычный участник комментирует новость", async () => {
    /* Это и есть смысл правки: лента, в которой отвечать может только
       модерация, — тот же молчащий канал, из которого новости и вытаскивали. */
    const res = await callPost({ content: "Спасибо!" });
    expect(res.status).toBe(200);
    expect(res.body.comment.id).toBe("c1");
    expect(prismaMock.message.create).toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: комментарий уходит в ветку поста и в его канал", async () => {
    /* Канал берётся у поста, а не из тела запроса: иначе комментарий можно
       было бы «положить» в чужой канал. Пустой threadId сделал бы из
       комментария самостоятельный пост в ленте. */
    await callPost({ content: "Спасибо!" });
    const args = prismaMock.message.create.mock.calls[0]![0] as {
      data: { threadId: string; channelId: string; userId: string };
    };
    expect(args.data.threadId).toBe("p1");
    expect(args.data.channelId).toBe("ch1");
    expect(args.data.userId).toBe("reader");
  });

  it("счётчик комментариев на посте растёт", async () => {
    await callPost({ content: "Спасибо!" });
    expect(prismaMock.message.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { threadCount: { increment: 1 } },
    });
  });

  it("ИНВАРИАНТ: нет права читать канал — нет и комментария", async () => {
    mockPermissions.mockResolvedValue(permissions({ canView: false, canComment: false, denialReason: "У вас нет доступа к этому каналу" }));
    const res = await callPost({ content: "привет" });
    expect(res.status).toBe(403);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: закрытое обсуждение закрыто и для модерации", async () => {
    /* Иначе «закрыть комментарии» означало бы «закрыть для остальных». */
    prismaMock.message.findUnique.mockResolvedValue(postRow({ commentsClosed: true }));
    mockPermissions.mockResolvedValue(permissions({ canModerate: true, canPost: true, role: "MODERATOR" }));
    const res = await callPost({ content: "а я всё равно" });
    expect(res.status).toBe(403);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: неопубликованный пост не комментируется даже автором", async () => {
    /* Комментарий появился бы раньше самой новости. */
    mockSession.mockResolvedValue({ user: { id: "author" } } as never);
    prismaMock.message.findUnique.mockResolvedValue(
      postRow({ publishAt: new Date(Date.now() + 3600_000), announcedAt: null }),
    );
    expect((await callPost({ content: "первый" })).status).toBe(403);
  });

  it("ИНВАРИАНТ: тайм-аут действует и на комментарии", async () => {
    /* Иначе ограниченный человек просто переезжает писать под посты. */
    mockTimeout.mockResolvedValue({ mutedUntil: new Date(Date.now() + 3600_000), muteReason: "флуд" } as never);
    const res = await callPost({ content: "всё равно пишу" });
    expect(res.status).toBe(403);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: словарь сообщества действует и на комментарии", async () => {
    /* Запрет должен отказать в отправке, а не удалять отправленное. */
    mockCensor.mockResolvedValue({ matches: ["плохое"], level: "BLOCK", blocked: true } as never);
    const res = await callPost({ content: "плохое слово" });
    expect(res.status).toBe(422);
    expect(res.body.censored).toBe(true);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("ФИКСАЦИЯ: словарь не проверяют у модерации", async () => {
    /* Правило устанавливают они же; администратор, споткнувшийся о собственный
       словарь, выглядит нелепо (та же логика, что в /api/messages). */
    mockPermissions.mockResolvedValue(permissions({ canModerate: true, role: "MODERATOR" }));
    await callPost({ content: "любой текст" });
    expect(mockCensor).not.toHaveBeenCalled();
  });

  it("пустой комментарий не отправляется", async () => {
    expect((await callPost({ content: "   " })).status).toBe(400);
    expect((await callPost({})).status).toBe(400);
  });
});
