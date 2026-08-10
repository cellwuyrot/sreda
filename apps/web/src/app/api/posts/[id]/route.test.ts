/**
 * Тесты: /api/posts/[id] — правка и удаление поста ленты.
 *
 * Проверяется то, чем маршрут может навредить:
 *
 *   • чужой пост не должен править и удалять посторонний;
 *   • существование чужого черновика не должно быть видно по коду ответа;
 *   • комментарий не должен превратиться в пост через этот же маршрут;
 *   • закрепление меняет верх ленты для всех — это дело модерации;
 *   • удаление поста не должно оставлять обсуждение висеть в ленте.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn(async () => null) }));
vi.mock("@/lib/connectPermissions", () => ({ getChannelPermissions: vi.fn() }));
vi.mock("@/lib/createNotification", () => ({
  createNotificationsBulk: vi.fn(async () => 1),
  deleteSubjectNotifications: vi.fn(async () => 0),
}));

import { getServerSession } from "next-auth";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { createNotificationsBulk, deleteSubjectNotifications } from "@/lib/createNotification";

const mockSession = vi.mocked(getServerSession);
const mockPermissions = vi.mocked(getChannelPermissions);
const mockBulk = vi.mocked(createNotificationsBulk);
const mockDropNotifications = vi.mocked(deleteSubjectNotifications);

const CHANNEL = {
  id: "ch1",
  groupId: "g1",
  name: "новости",
  hidden: false,
  isRestricted: false,
  readAccess: "ALL",
  group: { paused: false },
  allowedRoles: [] as { roleId: string }[],
};

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
    channel: CHANNEL,
    ...over,
  });
}

async function callPatch(body: unknown) {
  const mod = await import("@/app/api/posts/[id]/route");
  const request = new Request("http://localhost/api/posts/p1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
  const res = await mod.PATCH(request, { params: Promise.resolve({ id: "p1" }) });
  return { status: res.status, body: await res.json() };
}

async function callDelete() {
  const mod = await import("@/app/api/posts/[id]/route");
  const request = new Request("http://localhost/api/posts/p1", { method: "DELETE" }) as never;
  const res = await mod.DELETE(request, { params: Promise.resolve({ id: "p1" }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "author", role: "USER" } } as never);
  mockPermissions.mockResolvedValue(permissions());
  mockBulk.mockClear();
  mockBulk.mockResolvedValue(1);
  mockDropNotifications.mockClear();
  mockDropNotifications.mockResolvedValue(0);

  prismaMock.message.findUnique.mockResolvedValue(postRow());
  prismaMock.message.update.mockResolvedValue(postRow());
  prismaMock.message.updateMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.message.delete.mockResolvedValue(postRow());
  prismaMock.message.deleteMany.mockResolvedValue({ count: 2 } as never);
  prismaMock.groupMember.findMany.mockResolvedValue([
    row({ userId: "reader", role: "MEMBER", muted: false, tags: [] }),
  ]);
  prismaMock.channelMute.findMany.mockResolvedValue([]);
});

// ── Кого пускают к посту ─────────────────────────────────────────────────────

describe("доступ к посту", () => {
  it("без входа — 401", async () => {
    mockSession.mockResolvedValue(null);
    expect((await callPatch({ content: "правка" })).status).toBe(401);
  });

  it("поста нет — 404", async () => {
    prismaMock.message.findUnique.mockResolvedValue(null);
    expect((await callPatch({ content: "правка" })).status).toBe(404);
  });

  it("ИНВАРИАНТ: комментарий постом не становится", async () => {
    /* Иначе PATCH по идентификатору реплики приделал бы к ней заголовок с
       обложкой и вытолкнул её в ленту. */
    prismaMock.message.findUnique.mockResolvedValue(postRow({ threadId: "parent" }));
    expect((await callPatch({ title: "Я теперь пост" })).status).toBe(404);
    expect(prismaMock.message.update).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: чужой черновик отвечает «не найдено», а не «нельзя»", async () => {
    /* Разница между «поста нет» и «пост есть, но чужой» — это и есть утечка:
       по коду ответа было бы видно, что человек что-то пишет. */
    mockSession.mockResolvedValue({ user: { id: "someone" } } as never);
    prismaMock.message.findUnique.mockResolvedValue(postRow({ draft: true }));
    expect((await callPatch({ content: "правка" })).status).toBe(404);
  });

  it("ИНВАРИАНТ: чужой пост не правит посторонний", async () => {
    mockSession.mockResolvedValue({ user: { id: "someone" } } as never);
    mockPermissions.mockResolvedValue(permissions({ canModerate: false, canPost: false, role: "MEMBER" }));
    const res = await callPatch({ content: "подменяю текст" });
    expect(res.status).toBe(403);
    expect(prismaMock.message.update).not.toHaveBeenCalled();
  });

  it("модератор правит чужой пост", async () => {
    mockSession.mockResolvedValue({ user: { id: "mod" } } as never);
    expect((await callPatch({ content: "поправлено" })).status).toBe(200);
  });
});

// ── Правка ───────────────────────────────────────────────────────────────────

describe("правка поста", () => {
  it("изменение текста ставит пометку «изменено»", async () => {
    await callPatch({ content: "новый текст" });
    const args = prismaMock.message.update.mock.calls[0]![0] as { data: { edited: boolean; editedAt: Date } };
    expect(args.data.edited).toBe(true);
    expect(args.data.editedAt).toBeInstanceOf(Date);
  });

  it("ФИКСАЦИЯ: закрытие комментариев пометкой «изменено» не считается", async () => {
    /* Это действие модерации, а не переписывание новости: «изменено» рядом с
       текстом означало бы, что текст трогали. */
    await callPatch({ commentsClosed: true });
    const args = prismaMock.message.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(args.data.commentsClosed).toBe(true);
    expect(args.data.edited).toBeUndefined();
  });

  it("ФИКСАЦИЯ: тот же текст пометку не ставит", async () => {
    /* Открыл редактор, ничего не поменял, нажал «сохранить» — новость не
       должна помечаться изменённой. */
    await callPatch({ content: "Текст", title: "Заголовок" });
    const args = prismaMock.message.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(args.data.edited).toBeUndefined();
  });

  it("ИНВАРИАНТ: обложку нельзя подменить чужим адресом и через правку", async () => {
    /* Иначе проверка при создании обходится одним PATCH. */
    const res = await callPatch({ cover: "https://evil.tld/pixel.png" });
    expect(res.status).toBe(400);
    expect(prismaMock.message.update).not.toHaveBeenCalled();
  });

  it("обложку можно снять", async () => {
    await callPatch({ cover: null });
    const args = prismaMock.message.update.mock.calls[0]![0] as { data: { cover: string | null } };
    expect(args.data.cover).toBeNull();
  });

  it("ИНВАРИАНТ: закреплять может только модерация", async () => {
    /* Закрепление меняет верх ленты для всего сообщества, а не свой пост. */
    mockPermissions.mockResolvedValue(permissions({ canModerate: false, role: "MEMBER" }));
    const res = await callPatch({ pinned: true });
    expect(res.status).toBe(403);
    expect(prismaMock.message.update).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: опубликованный пост нельзя вернуть в черновики", async () => {
    /* Его уже видели и прокомментировали: «спрятать» означало бы, что
       обсуждение исчезло у всех, кроме автора. */
    const res = await callPatch({ draft: true });
    expect(res.status).toBe(400);
    expect(prismaMock.message.update).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: время публикации у вышедшей новости не переносится", async () => {
    /* Сдвиг даты уже не спрячет её, а разойдётся с тем, что люди прочитали. */
    const res = await callPatch({ publishAt: Date.now() + 3600_000 });
    expect(res.status).toBe(400);
  });

  it("ФИКСАЦИЯ: пустое время публикации у вышедшей новости не мешает её править", async () => {
    /* Редактор шлёт publishAt в каждой правке; отказ за «publishAt: null» был
       бы отказом править обычную новость вообще. */
    const res = await callPatch({ content: "поправлено", publishAt: null });
    expect(res.status).toBe(200);
    const args = prismaMock.message.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(args.data).not.toHaveProperty("publishAt");
  });

  it("у ещё не вышедшего поста время публикации меняется", async () => {
    prismaMock.message.findUnique.mockResolvedValue(postRow({ draft: true, announcedAt: null }));
    const later = Date.now() + 3600_000;
    await callPatch({ publishAt: later });
    const args = prismaMock.message.update.mock.calls[0]![0] as { data: { publishAt: Date } };
    expect(args.data.publishAt.getTime()).toBe(later);
  });

  it("пустой запрос ничего не меняет", async () => {
    expect((await callPatch({})).status).toBe(400);
    expect(prismaMock.message.update).not.toHaveBeenCalled();
  });
});

// ── Публикация черновика ─────────────────────────────────────────────────────

describe("черновик становится постом", () => {
  it("снятие черновика уведомляет читателей", async () => {
    prismaMock.message.findUnique
      .mockResolvedValueOnce(postRow({ draft: true, announcedAt: null }))
      .mockResolvedValue(postRow({ draft: false, announcedAt: null }));
    prismaMock.message.update.mockResolvedValue(postRow({ draft: false, announcedAt: null }));

    const res = await callPatch({ draft: false });
    expect(res.status).toBe(200);
    expect(mockBulk).toHaveBeenCalledTimes(1);
    expect(mockBulk.mock.calls[0]![0].userIds).toEqual(["reader"]);
  });

  it("ИНВАРИАНТ: повторная правка второй раз не уведомляет", async () => {
    /* announcedAt уже стоит — иначе каждая опечатка в тексте вызывала бы новую
       волну уведомлений об одной и той же новости. */
    await callPatch({ content: "поправил опечатку" });
    expect(mockBulk).not.toHaveBeenCalled();
  });
});

// ── Удаление ─────────────────────────────────────────────────────────────────

describe("удаление поста", () => {
  it("ИНВАРИАНТ: комментарии удаляются вместе с постом", async () => {
    /* Связь threadId настроена на SetNull: без явного удаления комментарии
       превратились бы в самостоятельные сообщения и всплыли бы в ленте как
       посты без заголовка. */
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(prismaMock.message.deleteMany).toHaveBeenCalledWith({ where: { threadId: "p1" } });
    expect(prismaMock.message.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });

  it("ИНВАРИАНТ: уведомления об удалённом посте гаснут", async () => {
    /* Уведомление, ведущее в никуда, хуже отсутствия уведомления. */
    await callDelete();
    expect(mockDropNotifications).toHaveBeenCalledWith("news_post", "p1");
  });

  it("ИНВАРИАНТ: чужой пост не удаляет посторонний", async () => {
    mockSession.mockResolvedValue({ user: { id: "someone" } } as never);
    mockPermissions.mockResolvedValue(permissions({ canModerate: false, role: "MEMBER" }));
    const res = await callDelete();
    expect(res.status).toBe(403);
    expect(prismaMock.message.delete).not.toHaveBeenCalled();
    expect(prismaMock.message.deleteMany).not.toHaveBeenCalled();
  });

  it("модератор удаляет чужой пост", async () => {
    mockSession.mockResolvedValue({ user: { id: "mod" } } as never);
    expect((await callDelete()).status).toBe(200);
  });
});
