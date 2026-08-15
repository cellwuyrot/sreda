import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { sanitizeText } from "@/lib/sanitize";
import { logAction } from "@/lib/audit";
import {
  MAX_WALL_CONTENT,
  MAX_WALL_PINNED,
  MAX_WALL_TITLE,
  WALL_AUTHOR_SELECT,
  sanitizeWallAttachments,
  sanitizeWallMedia,
  serializeWallPost,
  type WallPostRow,
} from "@/lib/wallPost";

/**
 * PROFILE-WALL: отдельная запись стены.
 *
 *   PATCH  — правка текста, закрепление, закрытие комментариев (только автор)
 *   DELETE — автор или модерация
 *
 * Удаление помечает запись флагом, а не стирает строку: комментарии под ней
 * остаются материалом разбирательства, если запись снёсла модерация.
 */

const POST_INCLUDE = {
  author: { select: WALL_AUTHOR_SELECT },
  _count: { select: { comments: true } },
} as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const post = await prisma.wallPost.findUnique({
    where: { id },
    select: { id: true, authorId: true, deleted: true, pinned: true },
  });
  if (!post || post.deleted) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  if (post.authorId !== session.user.id) {
    return NextResponse.json({ error: "Править может только автор" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });

  const data: Record<string, unknown> = {};

  if (typeof body.content === "string") {
    const content = sanitizeText(body.content).slice(0, MAX_WALL_CONTENT);
    if (!content.trim()) return NextResponse.json({ error: "Запись пустая" }, { status: 400 });
    data.content = content;
    data.editedAt = new Date();
  }
  if (typeof body.title === "string") {
    const title = sanitizeText(body.title).replace(/\s+/g, " ").trim().slice(0, MAX_WALL_TITLE);
    data.title = title || null;
    data.editedAt = new Date();
  }
  if ("cover" in body) {
    data.cover = sanitizeWallMedia(body.cover);
    data.editedAt = new Date();
  }
  if ("attachments" in body) {
    const attachments = sanitizeWallAttachments(body.attachments);
    data.attachments = attachments.length ? JSON.stringify(attachments) : null;
    data.editedAt = new Date();
  }
  if (typeof body.commentsClosed === "boolean") {
    data.commentsClosed = body.commentsClosed;
  }
  if (typeof body.pinned === "boolean") {
    /* Предел закреплённых проверяется на сервере: иначе вся стена со временем
       оказывается закреплённой, а закрепление перестаёт что-либо значить. */
    if (body.pinned && !post.pinned) {
      const pinnedCount = await prisma.wallPost.count({
        where: { authorId: session.user.id, pinned: true, deleted: false },
      });
      if (pinnedCount >= MAX_WALL_PINNED) {
        return NextResponse.json(
          { error: `Закрепить можно не больше ${MAX_WALL_PINNED} записей` },
          { status: 400 },
        );
      }
    }
    data.pinned = body.pinned;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нечего менять" }, { status: 400 });
  }

  const updated = await prisma.wallPost.update({ where: { id }, data, include: POST_INCLUDE });

  return NextResponse.json(
    serializeWallPost(updated as unknown as WallPostRow, {
      userId: session.user.id,
      isOwner: true,
      canModerate: false,
    }),
  );
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const post = await prisma.wallPost.findUnique({
    where: { id },
    select: { id: true, authorId: true, deleted: true },
  });
  if (!post || post.deleted) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });

  const role = (session.user as { role?: string }).role;
  const canModerate = role === "ADMIN" || role === "EDITOR";
  if (post.authorId !== session.user.id && !canModerate) {
    return NextResponse.json({ error: "Нет прав" }, { status: 403 });
  }

  await prisma.wallPost.update({ where: { id }, data: { deleted: true } });

  /* Чужую запись сняла модерация — это действие власти, и оно должно быть в
     журнале. Своё удаление журналировать нечего. */
  if (post.authorId !== session.user.id) {
    await logAction({
      userId: session.user.id,
      username: session.user.username || session.user.name || "",
      action: "wall.post.delete",
      target: "WallPost",
      targetId: id,
      details: `автор: ${post.authorId}`,
    });
  }

  return NextResponse.json({ ok: true });
}
