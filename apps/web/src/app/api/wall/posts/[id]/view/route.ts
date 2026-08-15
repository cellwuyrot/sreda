import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * PROFILE-WALL: отметка о просмотре.
 *
 * Счётчик растёт только на ПЕРВОМ просмотре каждого человека: уникальность пары
 * держит база, поэтому две вкладки и обновление страницы не накручивают число.
 * Свои просмотры не считаются — иначе автор сам себе первый читатель.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const post = await prisma.wallPost.findUnique({
    where: { id },
    select: { id: true, authorId: true, deleted: true, views: true },
  });
  if (!post || post.deleted) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  if (post.authorId === session.user.id) return NextResponse.json({ views: post.views });

  try {
    await prisma.wallPostView.create({ data: { postId: id, userId: session.user.id } });
  } catch {
    /* Уже смотрел — уникальность пары отклонила вторую строку. */
    return NextResponse.json({ views: post.views });
  }

  const updated = await prisma.wallPost.update({
    where: { id },
    data: { views: { increment: 1 } },
    select: { views: true },
  });
  return NextResponse.json({ views: updated.views });
}
