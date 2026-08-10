/**
 * Тесты модуля connectPermissions.ts
 * Зона B, P0 — права на каналы и беседы.
 */

import { describe, it, expect, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const {
  getChannelPermissions,
  getChannelPermissionsBatch,
  canAccessConversation,
  getGroupRole,
} = await import("@/lib/connectPermissions");

// ── Вспомогательные фабрики ───────────────────────────────────────────────────

/** Базовый канал — обычный открытый канал. */
function makeChannel(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "chan-1",
    groupId: "group-1",
    type: "TEXT",
    isRestricted: false,
    hidden: false,
    postAccess: "ALL",
    readAccess: "ALL",
    askAccess: "ALL",
    answerAccess: "ALL",
    group: { paused: false },
    allowedRoles: [],
    ...overrides,
  };
}

/** Членство участника. */
function makeMembership(role = "MEMBER") {
  return { role, tags: [] };
}

// ── getChannelPermissions: участника нет ──────────────────────────────────────

describe("getChannelPermissions: не-участник", () => {
  it("возвращает null если канал не найден", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(null);
    const result = await getChannelPermissions("u1", "chan-missing");
    expect(result).toBeNull();
  });

  it("canView=false для не-участника", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel()));
    prismaMock.groupMember.findUnique.mockResolvedValue(null);

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms).not.toBeNull();
    expect(perms!.canView).toBe(false);
    expect(perms!.canPost).toBe(false);
    expect(perms!.isMember).toBe(false);
    expect(perms!.denialReason).toBe("Вы не состоите в этом сообществе");
  });

  it("пустой userId возвращает null", async () => {
    expect(await getChannelPermissions("", "chan-1")).toBeNull();
  });

  it("пустой channelId возвращает null", async () => {
    expect(await getChannelPermissions("u1", "")).toBeNull();
  });
});

// ── getChannelPermissions: видимость канала ───────────────────────────────────

describe("getChannelPermissions: видимость канала", () => {
  it("MEMBER видит обычный открытый канал", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel()));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canView).toBe(true);
  });

  it("MEMBER не видит скрытый канал", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel({ hidden: true })));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canView).toBe(false);
  });

  it("MODERATOR видит скрытый канал", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel({ hidden: true })));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MODERATOR")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canView).toBe(true);
  });

  it("MEMBER не видит канал с readAccess=MOD", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel({ readAccess: "MOD" })));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canView).toBe(false);
  });

  it("MODERATOR видит канал с readAccess=MOD", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel({ readAccess: "MOD" })));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MODERATOR")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canView).toBe(true);
  });

  it("MEMBER не видит канал с readAccess=ADMIN", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel({ readAccess: "ADMIN" })));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canView).toBe(false);
  });

  it("ADMIN видит канал с readAccess=ADMIN", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel({ readAccess: "ADMIN" })));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("ADMIN")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canView).toBe(true);
  });

  it("MEMBER не видит канал когда сообщество на паузе", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(
      row(makeChannel({ group: { paused: true } }))
    );
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canView).toBe(false);
    expect(perms!.denialReason).toContain("приостановлено");
  });

  it("ADMIN может читать канал когда сообщество на паузе (canBypassPause)", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(
      row(makeChannel({ group: { paused: true } }))
    );
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("ADMIN")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canView).toBe(true);
    expect(perms!.canBypassPause).toBe(true);
  });
});

// ── getChannelPermissions: право писать ───────────────────────────────────────

describe("getChannelPermissions: canPost", () => {
  it("MEMBER может писать в открытый TEXT канал", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel()));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canPost).toBe(true);
  });

  it("MEMBER не может писать в NEWS канал", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel({ type: "NEWS" })));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canPost).toBe(false);
  });

  it("MODERATOR может писать в NEWS канал", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel({ type: "NEWS" })));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MODERATOR")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canPost).toBe(true);
  });

  it("MEMBER не может писать если postAccess=MOD", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel({ postAccess: "MOD" })));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canPost).toBe(false);
    expect(perms!.denialReason).toContain("недостаточно прав");
  });

  it("MEMBER не может писать если postAccess=ADMIN", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel({ postAccess: "ADMIN" })));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canPost).toBe(false);
  });
});

// ── getChannelPermissions: роли ───────────────────────────────────────────────

describe("getChannelPermissions: нормализация ролей", () => {
  it("canManage=true для OWNER", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel()));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("OWNER")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canManage).toBe(true);
    expect(perms!.canModerate).toBe(true);
  });

  it("canModerate=true но canManage=false для MODERATOR", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel()));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MODERATOR")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.canModerate).toBe(true);
    expect(perms!.canManage).toBe(false);
  });

  it("неизвестная роль нормализуется до MEMBER", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row(makeChannel()));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("SUPERADMIN")));

    const perms = await getChannelPermissions("u1", "chan-1");
    expect(perms!.role).toBe("MEMBER");
    expect(perms!.canManage).toBe(false);
    expect(perms!.canModerate).toBe(false);
  });
});

// ── getChannelPermissionsBatch ────────────────────────────────────────────────

describe("getChannelPermissionsBatch: соответствие одиночному вызову", () => {
  it("пустой channelIds возвращает пустую Map", async () => {
    const result = await getChannelPermissionsBatch("u1", []);
    expect(result.size).toBe(0);
  });

  it("пустой userId возвращает пустую Map", async () => {
    const result = await getChannelPermissionsBatch("", ["chan-1"]);
    expect(result.size).toBe(0);
  });

  it("batch даёт тот же canView что и одиночный вызов — открытый канал MEMBER", async () => {
    const channel = makeChannel();

    // Одиночный вызов
    prismaMock.channel.findUnique.mockResolvedValue(row(channel));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));
    const single = await getChannelPermissions("u1", "chan-1");

    // Пакетный вызов
    prismaMock.channel.findMany.mockResolvedValue(row([channel]));
    prismaMock.groupMember.findMany.mockResolvedValue(row([
      { groupId: "group-1", role: "MEMBER", tags: [] },
    ]));
    const batch = await getChannelPermissionsBatch("u1", ["chan-1"]);

    const batchPerms = batch.get("chan-1");
    expect(batchPerms).not.toBeUndefined();
    expect(batchPerms!.canView).toBe(single!.canView);
    expect(batchPerms!.canPost).toBe(single!.canPost);
    expect(batchPerms!.canManage).toBe(single!.canManage);
  });

  it("batch даёт тот же canView что и одиночный — NEWS канал MEMBER (canPost=false)", async () => {
    const channel = makeChannel({ type: "NEWS" });

    prismaMock.channel.findUnique.mockResolvedValue(row(channel));
    prismaMock.groupMember.findUnique.mockResolvedValue(row(makeMembership("MEMBER")));
    const single = await getChannelPermissions("u1", "chan-1");

    prismaMock.channel.findMany.mockResolvedValue(row([channel]));
    prismaMock.groupMember.findMany.mockResolvedValue(row([
      { groupId: "group-1", role: "MEMBER", tags: [] },
    ]));
    const batch = await getChannelPermissionsBatch("u1", ["chan-1"]);

    const batchPerms = batch.get("chan-1");
    expect(batchPerms!.canPost).toBe(single!.canPost);
    expect(batchPerms!.canPost).toBe(false);
  });

  it("batch не-участника: canView=false совпадает с одиночным", async () => {
    const channel = makeChannel();

    prismaMock.channel.findUnique.mockResolvedValue(row(channel));
    prismaMock.groupMember.findUnique.mockResolvedValue(null);
    const single = await getChannelPermissions("u1", "chan-1");

    prismaMock.channel.findMany.mockResolvedValue(row([channel]));
    prismaMock.groupMember.findMany.mockResolvedValue(row([]));
    const batch = await getChannelPermissionsBatch("u1", ["chan-1"]);

    const batchPerms = batch.get("chan-1");
    expect(batchPerms!.canView).toBe(single!.canView);
    expect(batchPerms!.canView).toBe(false);
  });
});

// ── canAccessConversation ─────────────────────────────────────────────────────

describe("canAccessConversation", () => {
  it("true если пользователь — user1Id", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(row({
      user1Id: "u1",
      user2Id: "u2",
    }));
    expect(await canAccessConversation("u1", "conv-1")).toBe(true);
  });

  it("true если пользователь — user2Id", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(row({
      user1Id: "u1",
      user2Id: "u2",
    }));
    expect(await canAccessConversation("u2", "conv-1")).toBe(true);
  });

  it("false для стороннего пользователя", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(row({
      user1Id: "u1",
      user2Id: "u2",
    }));
    expect(await canAccessConversation("u3", "conv-1")).toBe(false);
  });

  it("false если беседа не найдена", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(null);
    expect(await canAccessConversation("u1", "conv-missing")).toBe(false);
  });

  it("false при пустом userId", async () => {
    expect(await canAccessConversation("", "conv-1")).toBe(false);
  });

  it("false при пустом conversationId", async () => {
    expect(await canAccessConversation("u1", "")).toBe(false);
  });

  /**
   * ИНВАРИАНТ: роль администрации открывает ТОЛЬКО деловой разговор по
   * обращению. Личная переписка администрации недоступна — читать чужие личные
   * сообщения не входит в её полномочия.
   */
  it("ИНВАРИАНТ: администратор вне пары читает деловой разговор, но не личную переписку", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(row({
      user1Id: "client-1",
      user2Id: "admin-1",
      kind: "BUSINESS",
    }));
    prismaMock.user.findUnique.mockResolvedValue(row({ role: "ADMIN" }));
    expect(await canAccessConversation("admin-9", "conv-b")).toBe(true);

    prismaMock.directConversation.findUnique.mockResolvedValue(row({
      user1Id: "u1",
      user2Id: "u2",
      kind: "PERSONAL",
    }));
    expect(await canAccessConversation("admin-9", "conv-p")).toBe(false);
  });

  it("редактор в деловой разговор проходит, обычный пользователь — нет", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(row({
      user1Id: "client-1",
      user2Id: "admin-1",
      kind: "BUSINESS",
    }));
    prismaMock.user.findUnique.mockResolvedValue(row({ role: "EDITOR" }));
    expect(await canAccessConversation("editor-9", "conv-b")).toBe(true);

    prismaMock.user.findUnique.mockResolvedValue(row({ role: "USER" }));
    expect(await canAccessConversation("stranger", "conv-b")).toBe(false);
  });

  /* Участнику роль не спрашиваем: лишний запрос на каждое сообщение личной
     переписки заметен, а решение уже принято по участию в паре. */
  it("для участника роль в базе не спрашивается", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(row({
      user1Id: "u1",
      user2Id: "u2",
      kind: "PERSONAL",
    }));
    prismaMock.user.findUnique.mockResolvedValue(row({ role: "ADMIN" }));
    await canAccessConversation("u1", "conv-1");
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

// ── getGroupRole ──────────────────────────────────────────────────────────────

describe("getGroupRole", () => {
  it("возвращает нормализованную роль OWNER", async () => {
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "OWNER" }));
    expect(await getGroupRole("u1", "g1")).toBe("OWNER");
  });

  it("нормализует неизвестную роль до MEMBER", async () => {
    prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "SUPERMOD" }));
    expect(await getGroupRole("u1", "g1")).toBe("MEMBER");
  });

  it("возвращает null если нет членства", async () => {
    prismaMock.groupMember.findUnique.mockResolvedValue(null);
    expect(await getGroupRole("u1", "g1")).toBeNull();
  });
});
