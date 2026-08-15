/**
 * PROFILE-WALL: правила личной страницы.
 *
 * Стена устроена как лента новостей и намеренно повторяет её правила обработки
 * текста, обложки и вложений (см. lib/newsPost): человек не должен угадывать, почему
 * тот же текст в новостях выглядит так, а у себя на странице иначе.
 *
 * Отличий два, и оба из-за отсутствия канала:
 *
 *   1. Право писать есть только у владельца страницы — больше ни у кого, включая
 *      администрацию. Администратор может УДАЛИТЬ чужую запись (это модерация),
 *      но не может написать за человека от его имени.
 *   2. Читать стену может любой вошедший — кроме того, кого владелец добавил в
 *      чёрный список (UserIgnore). Закрытый человек не должен читать стену того, кто
 *      от него закрылся, иначе чёрный список оборачивается витриной для него же.
 */

import prisma from "@/lib/prisma";

/**
 * Сколько записей, подписок и подписчиков на одной странице.
 *
 * Число общее для всех трёх списков и задано в одном месте: разные размеры страниц
 * в соседних вкладках читаются как ошибка, а не как замысел.
 */
export const WALL_PAGE_SIZE = 15;

/** Длиннее запись не читают, а в базе это уже не запись, а способ её раздуть. */
export const MAX_WALL_CONTENT = 10000;

/** Комментарий — реплика, а не вторая запись. */
export const MAX_WALL_COMMENT = 2000;

export const MAX_WALL_TITLE = 200;

/** Столько же вложений, сколько у поста новостей. */
export const MAX_WALL_ATTACHMENTS = 10;

/** Закреплённых больше — уже не закрепление, а вторая лента. */
export const MAX_WALL_PINNED = 3;

/**
 * Обложка и адреса вложений — только путь внутрь нашего хранилища.
 *
 * Тот же запрет, что и у обложки новости: чужой адрес превращает стену в способ
 * собирать адреса всех, кто её открыл. `//host` браузер трактует как чужой сайт,
 * поэтому двойная косая отбрасывается отдельно, а `..` — это попытка выйти из
 * каталога загрузок.
 */
export function sanitizeWallMedia(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path) return null;
  if (!path.startsWith("/")) return null;
  if (path.startsWith("//")) return null;
  if (path.includes("..")) return null;
  if (path.includes("\\")) return null;
  if (path.length > 400) return null;
  return path;
}

export interface WallAttachment {
  url: string;
  name: string;
  size?: number;
  type?: string;
}

/**
 * Вложения приходят от клиента и потому проверяются поле за полем.
 *
 * Непригодные записи не обрушают сохранение, а отбрасываются: потерять текст
 * записи из-за одного битого вложения — худший из исходов.
 */
export function sanitizeWallAttachments(value: unknown): WallAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: WallAttachment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const url = sanitizeWallMedia(item.url);
    if (!url) continue;
    const name = typeof item.name === "string" ? item.name.slice(0, 200) : "Файл";
    const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : undefined;
    const type = typeof item.type === "string" ? item.type.slice(0, 100) : undefined;
    out.push({ url, name, size, type });
    if (out.length >= MAX_WALL_ATTACHMENTS) break;
  }
  return out;
}

export function parseWallAttachments(raw: string | null | undefined): WallAttachment[] {
  if (!raw) return [];
  try {
    return sanitizeWallAttachments(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Номер страницы из адреса. Мусор и отрицательные — это первая страница. */
export function parsePage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 10000);
}

export const WALL_AUTHOR_SELECT = {
  id: true,
  name: true,
  username: true,
  avatar: true,
  role: true,
  avatarGlowEnabled: true,
  avatarGlowColors: true,
} as const;

export interface WallViewer {
  userId: string;
  isOwner: boolean;
  canModerate: boolean;
}

export interface WallPostRow {
  id: string;
  title: string | null;
  content: string;
  cover: string | null;
  attachments: string | null;
  pinned: boolean;
  views: number;
  commentsClosed: boolean;
  editedAt: Date | null;
  createdAt: Date;
  author: {
    id: string;
    name: string;
    username: string;
    avatar: string | null;
    role: string;
    avatarGlowEnabled: boolean;
    avatarGlowColors: string | null;
  };
  _count?: { comments: number };
}

export function serializeWallPost(row: WallPostRow, viewer: WallViewer) {
  return {
    id: row.id,
    title: row.title ?? "",
    content: row.content,
    cover: row.cover,
    attachments: parseWallAttachments(row.attachments),
    pinned: row.pinned,
    views: row.views,
    commentsClosed: row.commentsClosed,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    commentCount: row._count?.comments ?? 0,
    author: row.author,
    /* Права считаются на сервере и едут в ответе готовыми: клиент, который
       выводит их сам, рано или поздно показывает кнопку, которая ответит 403. */
    canEdit: viewer.userId === row.author.id,
    canDelete: viewer.userId === row.author.id || viewer.canModerate,
  };
}

/**
 * Видит ли смотрящий стену этого человека.
 *
 * Единственная причина отказа — чёрный список в любую сторону. В обе: если
 * смотрящий сам закрылся от владельца, показывать ему его записи тоже странно.
 */
export async function wallHidden(viewerId: string, ownerId: string): Promise<boolean> {
  if (viewerId === ownerId) return false;
  const ignore = await prisma.userIgnore.findFirst({
    where: {
      OR: [
        { userId: ownerId, ignoredId: viewerId },
        { userId: viewerId, ignoredId: ownerId },
      ],
    },
    select: { id: true },
  });
  return !!ignore;
}
