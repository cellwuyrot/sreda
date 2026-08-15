import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { WALL_PAGE_SIZE, WALL_AUTHOR_SELECT, parsePage } from "@/lib/wallPost";

/**
 * PROFILE-WALL: на кого подписан этот человек.
 *
 * Страницами по 15, а не бесконечной прокруткой: в списке на несколько сотен
 * человек прокрутка не даёт ни вернуться на место, ни понять, сколько осталось.
 * Вместе со страницей всегда едет общее число — иначе клиент не знает, рисовать
 * ли кнопку «дальше».
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: userId } = await params;
  const page = parsePage(req.nextUrl.searchParams.get("page"));
  const skip = (page - 1) * WALL_PAGE_SIZE;

  const where = { followerId: userId };

  const [total, rows] = await Promise.all([
    prisma.follow.count({ where }),
    prisma.follow.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: WALL_PAGE_SIZE,
      select: { createdAt: true, following: { select: WALL_AUTHOR_SELECT } },
    }),
  ]);

  /* Кто из них интересен самому смотрящему: без этого кнопка в списке всегда
     показывала бы «Подписаться», в том числе на тех, на кого он уже подписан. */
  const ids = rows.map((r) => r.following.id);
  const mine = ids.length
    ? await prisma.follow.findMany({
        where: { followerId: session.user.id, followingId: { in: ids } },
        select: { followingId: true },
      })
    : [];
  const followingSet = new Set(mine.map((m) => m.followingId));

  return NextResponse.json({
    users: rows.map((r) => ({
      ...r.following,
      followedAt: r.createdAt,
      isFollowing: followingSet.has(r.following.id),
      isSelf: r.following.id === session.user.id,
    })),
    page,
    perPage: WALL_PAGE_SIZE,
    total,
    pages: Math.max(1, Math.ceil(total / WALL_PAGE_SIZE)),
  });
}
