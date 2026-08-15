import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { sanitizeText } from "@/lib/sanitize";
import { createNotification } from "@/lib/createNotification";
import {
  MAX_WALL_COMMENT,
  WALL_AUTHOR_SELECT,
  WALL_PAGE_SIZE,
  parsePage,
  wallHidden,
} from "@/lib/wallPost";

/**
 * PROFILE-WALL: комментарии к записи стены — такими же страницами по 15.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const post = await prisma.wallPost.findUnique({
    where: { id },
    select: { id: true, authorId: true, deleted: true, commentsClosed: true },
  });
  if (!post || post.deleted) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  if (await wallHidden(session.user.id, post.authorId)) {
    return NextResponse.json({ error: "Страница недоступна" }, { status: 403 });
  }

  const page = parsePage(req.nextUrl.searchParams.get("page"));
  const where = { postId: id, deleted: false };
  const role = (session.user as { role?: string }).role;

  const [total, rows] = await Promise.all([
    prisma.wallComment.count({ where }),
    prisma.wallComment.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * WALL_PAGE_SIZE,
      take: WALL_PAGE_SIZE,
      include: { author: { select: WALL_AUTHOR_SELECT } },
    }),
  ]);

  return NextResponse.json({
    comments: rows.map((row) => ({
      id: row.id,
      content: row.content,
      createdAt: row.createdAt,
      author: row.author,
      canDelete:
        row.authorId === session.user.id ||
        post.authorId === session.user.id ||
        role === "ADMIN" ||
        role === "EDITOR",
    })),
    page,
    perPage: WALL_PAGE_SIZE,
    total,
    pages: Math.max(1, Math.ceil(total / WALL_PAGE_SIZE)),
    canComment: !post.commentsClosed,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const limited = await rateLimit(req, "wall-comment", { limit: 60, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const { id } = await params;
  const post = await prisma.wallPost.findUnique({
    where: { id },
    select: { id: true, authorId: true, deleted: true, commentsClosed: true, title: true, content: true },
  });
  if (!post || post.deleted) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  if (post.commentsClosed) {
    return NextResponse.json({ error: "Комментарии закрыты" }, { status: 403 });
  }
  if (await wallHidden(session.user.id, post.authorId)) {
    return NextResponse.json({ error: "Страница недоступна" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const content = sanitizeText(typeof body?.content === "string" ? body.content : "").slice(0, MAX_WALL_COMMENT);
  if (!content.trim()) return NextResponse.json({ error: "Пустой комментарий" }, { status: 400 });

  const comment = await prisma.wallComment.create({
    data: { postId: id, authorId: session.user.id, content },
    include: { author: { select: WALL_AUTHOR_SELECT } },
  });

  /* Автору записи — уведомление. Себе не шлём: комментарий под своей записью
     человек только что написал сам и видит его на экране. */
  if (post.authorId !== session.user.id) {
    const owner = await prisma.user.findUnique({
      where: { id: post.authorId },
      select: { username: true },
    });
    await createNotification({
      userId: post.authorId,
      type: "wall-comment",
      title: "Комментарий к записи",
      body: `${session.user.name || session.user.username}: ${content.slice(0, 120)}`,
      link: `/profile/${owner?.username ?? ""}?post=${id}`,
      actorId: session.user.id,
      entityType: "wall-post",
      entityId: id,
    });
  }

  return NextResponse.json(
    {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: comment.author,
      canDelete: true,
    },
    { status: 201 },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const commentId = req.nextUrl.searchParams.get("commentId");
  if (!commentId) return NextResponse.json({ error: "Не указан комментарий" }, { status: 400 });

  const comment = await prisma.wallComment.findUnique({
    where: { id: commentId },
    select: { id: true, postId: true, authorId: true, post: { select: { authorId: true } } },
  });
  if (!comment || comment.postId !== id) {
    return NextResponse.json({ error: "Комментарий не найден" }, { status: 404 });
  }

  const role = (session.user as { role?: string }).role;
  const allowed =
    comment.authorId === session.user.id ||
    comment.post.authorId === session.user.id ||
    role === "ADMIN" ||
    role === "EDITOR";
  if (!allowed) return NextResponse.json({ error: "Нет прав" }, { status: 403 });

  await prisma.wallComment.update({ where: { id: commentId }, data: { deleted: true } });
  return NextResponse.json({ ok: true });
}
