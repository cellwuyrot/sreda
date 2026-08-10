import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * ADM-COMM: список сообществ для модерации проекта.
 *
 * Раздел живёт внутри «Пользователей» и отвечает на один вопрос: кто отвечает
 * за сообщество и как его притормозить.
 *
 * ── Почему только создатель ────────────────────────────────────
 *
 * Маршрут отдаёт ВЛАДЕЛЬЦА и только его — ни списка участников, ни админов
 * сообщества. Это не экономия трафика, а граница доступа: сайтовому
 * администратору для модерации достаточно знать, с кого спросить. Выгружать
 * ему состав чужих сообществ целиком — избыточно и без того.
 *
 * Число участников при этом отдаётся: без него нельзя оценить масштаб
 * последствий паузы, а имён оно не раскрывает.
 */

/** Сколько сообществ на одном листе. Тот же шаг, что и у пользователей. */
export const COMMUNITIES_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  /* Только ADMIN. В отличие от списка пользователей, куда пускают и EDITOR,
     приостановка сообщества — мера административная, и читать очередь
     модерации должен тот же, кто вправе её применять. */
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();

  /* Искать можно и по названию сообщества, и по создателю. Второе важнее
     первого: жалоба приходит на человека, а найти надо все его сообщества. */
  const where = query
    ? {
        OR: [
          { name: { contains: query, mode: "insensitive" as const } },
          { owner: { name: { contains: query, mode: "insensitive" as const } } },
          { owner: { username: { contains: query, mode: "insensitive" as const } } },
          { owner: { email: { contains: query, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const perPageRaw = Number(searchParams.get("perPage"));
  const perPage = Number.isFinite(perPageRaw) && perPageRaw > 0
    ? Math.min(Math.floor(perPageRaw), MAX_PER_PAGE)
    : COMMUNITIES_PER_PAGE;

  const total = await prisma.group.count({ where });
  const pages = Math.max(1, Math.ceil(total / perPage));

  const pageRaw = Number(searchParams.get("page"));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(Math.floor(pageRaw), pages) : 1;

  const groups = await prisma.group.findMany({
    where,
    select: {
      id: true,
      name: true,
      icon: true,
      description: true,
      paused: true,
      isMain: true,
      createdAt: true,
      owner: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          avatar: true,
          role: true,
          banned: true,
          lastSeen: true,
        },
      },
      _count: { select: { members: true, channels: true } },
    },
    /* Приостановленные — наверх: это незакрытые дела модерации, и о них
       легко забыть, если они теряются в общем списке по дате. */
    orderBy: [{ paused: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * perPage,
    take: perPage,
  });

  const communities = groups.map((group) => ({
    id: group.id,
    name: group.name,
    icon: group.icon,
    description: group.description,
    paused: group.paused,
    isMain: group.isMain,
    createdAt: group.createdAt,
    memberCount: group._count.members,
    channelCount: group._count.channels,
    owner: group.owner,
  }));

  return NextResponse.json({ communities, total, page, pages, perPage });
}
