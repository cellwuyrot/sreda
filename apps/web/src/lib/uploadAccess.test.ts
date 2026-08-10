/**
 * Тесты модуля uploadAccess.ts
 * Зона B, P0 — права на файлы вложений.
 *
 * ВНИМАНИЕ: в модуле есть LRU-кэш verdictCache (20 000 записей, TTL 60 с).
 * Кэш живёт на уровне модуля и НЕ сбрасывается между тестами автоматически.
 * Чтобы кэш не ломал изоляцию, каждый тест использует уникальные пути файлов
 * (path = `file-<testId>.webp`), так что кэш-коллизий не возникает.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

// Мокаем prisma ДО импорта тестируемых модулей
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

// Мокаем connectPermissions — uploadAccess делегирует проверки туда
vi.mock("@/lib/connectPermissions", () => ({
  getChannelPermissions: vi.fn(),
  canAccessConversation: vi.fn(),
}));

const { canAccessUpload, recordUpload } = await import("@/lib/uploadAccess");
import { getChannelPermissions, canAccessConversation } from "@/lib/connectPermissions";

const mockGetChannelPermissions = getChannelPermissions as ReturnType<typeof vi.fn>;
const mockCanAccessConversation = canAccessConversation as ReturnType<typeof vi.fn>;

// ── canAccessUpload: базовые граничные случаи ─────────────────────────────────

describe("canAccessUpload: граничные случаи аргументов", () => {
  it("пустой userId возвращает deny", async () => {
    expect(await canAccessUpload("", "some/path.webp")).toBe("deny");
  });

  it("пустой path возвращает deny", async () => {
    expect(await canAccessUpload("user1", "")).toBe("deny");
  });

  it("оба пустые — deny", async () => {
    expect(await canAccessUpload("", "")).toBe("deny");
  });
});

// ── canAccessUpload: файл не найден в базе ────────────────────────────────────

describe("canAccessUpload: файл не найден (старые файлы)", () => {
  it("возвращает unknown если файла нет в uploadedFile", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(null);
    expect(await canAccessUpload("user1", "old-file-001.webp")).toBe("unknown");
  });
});

// ── canAccessUpload: загрузивший всегда имеет доступ ─────────────────────────

describe("canAccessUpload: загрузивший видит свой файл", () => {
  it("загрузивший получает allow независимо от привязки", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "uploaderX",
      channelId: null,
      conversationId: null,
      taskId: null,
    }));
    expect(await canAccessUpload("uploaderX", "own-file-002.webp")).toBe("allow");
  });
});

// ── canAccessUpload: файл привязан к каналу ───────────────────────────────────

describe("canAccessUpload: файл принадлежит каналу", () => {
  it("allow если canView=true у пользователя в канале", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "other",
      channelId: "chan-1",
      conversationId: null,
      taskId: null,
    }));
    mockGetChannelPermissions.mockResolvedValue({ canView: true });

    expect(await canAccessUpload("user2", "channel-file-003.webp")).toBe("allow");
  });

  it("deny если canView=false", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "other",
      channelId: "chan-2",
      conversationId: null,
      taskId: null,
    }));
    mockGetChannelPermissions.mockResolvedValue({ canView: false });

    expect(await canAccessUpload("user3", "channel-file-004.webp")).toBe("deny");
  });

  it("посторонний без прав получает deny (не unknown)", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "other",
      channelId: "chan-3",
      conversationId: null,
      taskId: null,
    }));
    // Не участник — getChannelPermissions возвращает null
    mockGetChannelPermissions.mockResolvedValue(null);

    const verdict = await canAccessUpload("stranger1", "channel-file-005.webp");
    expect(verdict).toBe("deny");
  });
});

// ── canAccessUpload: файл привязан к беседе ───────────────────────────────────

describe("canAccessUpload: файл принадлежит беседе", () => {
  it("allow если пользователь — участник беседы", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "other",
      channelId: null,
      conversationId: "conv-1",
      taskId: null,
    }));
    mockCanAccessConversation.mockResolvedValue(true);

    expect(await canAccessUpload("user4", "conv-file-006.webp")).toBe("allow");
  });

  it("deny если пользователь не участник беседы", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "other",
      channelId: null,
      conversationId: "conv-2",
      taskId: null,
    }));
    mockCanAccessConversation.mockResolvedValue(false);

    expect(await canAccessUpload("user5", "conv-file-007.webp")).toBe("deny");
  });
});

// ── canAccessUpload: файл привязан к задаче ───────────────────────────────────

describe("canAccessUpload: файл принадлежит задаче", () => {
  it("allow если задача есть в канале и canView=true", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "other",
      channelId: null,
      conversationId: null,
      taskId: "task-1",
    }));
    prismaMock.channelTask.findUnique.mockResolvedValue(row({ channelId: "chan-task-1" }));
    mockGetChannelPermissions.mockResolvedValue({ canView: true });

    expect(await canAccessUpload("user6", "task-file-008.webp")).toBe("allow");
  });

  it("deny если задача не найдена", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "other",
      channelId: null,
      conversationId: null,
      taskId: "task-missing",
    }));
    prismaMock.channelTask.findUnique.mockResolvedValue(null);

    expect(await canAccessUpload("user7", "task-file-009.webp")).toBe("deny");
  });

  it("deny если задача есть но canView=false", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "other",
      channelId: null,
      conversationId: null,
      taskId: "task-2",
    }));
    prismaMock.channelTask.findUnique.mockResolvedValue(row({ channelId: "chan-task-2" }));
    mockGetChannelPermissions.mockResolvedValue({ canView: false });

    expect(await canAccessUpload("user8", "task-file-010.webp")).toBe("deny");
  });
});

// ── canAccessUpload: файл без привязки ────────────────────────────────────────

describe("canAccessUpload: файл без привязки (материал проекта)", () => {
  it("deny для чужого пользователя (не загрузившего)", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "uploaderY",
      channelId: null,
      conversationId: null,
      taskId: null,
    }));

    expect(await canAccessUpload("stranger2", "unlinked-file-011.webp")).toBe("deny");
  });

  it("allow для загрузившего (проверка через uploaderId)", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({
      uploaderId: "uploaderZ",
      channelId: null,
      conversationId: null,
      taskId: null,
    }));

    expect(await canAccessUpload("uploaderZ", "unlinked-file-012.webp")).toBe("allow");
  });
});

// ── recordUpload ──────────────────────────────────────────────────────────────

describe("recordUpload", () => {
  it("вызывает upsert с правильными полями", async () => {
    prismaMock.uploadedFile.upsert.mockResolvedValue(row({}));

    await recordUpload({
      path: "messages/abc.webp",
      uploaderId: "user-rec-1",
      channelId: "chan-rec-1",
    });

    expect(prismaMock.uploadedFile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { path: "messages/abc.webp" },
        create: expect.objectContaining({
          path: "messages/abc.webp",
          uploaderId: "user-rec-1",
          channelId: "chan-rec-1",
        }),
      })
    );
  });

  it("не бросает ошибку если upsert завершился неудачей (best-effort)", async () => {
    prismaMock.uploadedFile.upsert.mockRejectedValue(new Error("DB error"));
    await expect(
      recordUpload({ path: "messages/fail.webp", uploaderId: "u1" })
    ).resolves.toBeUndefined();
  });
});
