import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { GROUP_MEMBER_SELECT, MEMBERS_PAGE_SIZE, groupMemberOrder, withMemberOverrides } from "@/lib/groupMemberSelect";

/** Верхняя граница страницы: экраны с автодогрузкой берут по 200 за запрос. */
const MAX_TAKE = 200;

/**
 * GET /api/groups/[id]/members — участники сообщества страницами.
 *
 * Параметры: `cursor` (id последнего показанного участника) либо `skip`, `take`
 * (по умолчанию 50, максимум 200) и `q` — поиск по имени и нику.
 *
 * Права те же, что у GET /api/groups/[id]: список видит любой участник группы.
 * checkBan здесь не нужен — маршрут только читает.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
    select: { id: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const cursor = url.searchParams.get("cursor");
  const skipRaw = Number(url.searchParams.get("skip") ?? 0);
  const takeRaw = Number(url.searchParams.get("take") ?? MEMBERS_PAGE_SIZE);
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;
  // Границы жёсткие: иначе take=100000 возвращал бы ту же тяжёлую выборку,
  // из-за которой участники и стали постраничными.
  const take = Number.isFinite(takeRaw) && takeRaw > 0 ? Math.min(Math.floor(takeRaw), MAX_TAKE) : MEMBERS_PAGE_SIZE;

  // Поиск идёт по обоим публичным именам: в списке видно и имя, и ник.
  const where = {
    groupId: id,
    ...(q
      ? {
          user: {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { username: { contains: q, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  const [members, total] = await Promise.all([
    prisma.groupMember.findMany({
      where,
      select: GROUP_MEMBER_SELECT,
      orderBy: groupMemberOrder(),
      take,
      // Курсор указывает на последнюю показанную строку, поэтому её саму
      // пропускаем. Без курсора работает обычное смещение.
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : { skip }),
    }),
    prisma.groupMember.count({ where }),
  ]);

  return NextResponse.json({
    // FIX-SRVSHOW: имя, аватар и фон — уже с учётом настроек для этого сообщества.
    members: members.map(withMemberOverrides),
    total,
    // При курсорной догрузке клиент своего смещения не знает, поэтому признак
    // «есть ещё» выводим из того, добрала ли страница запрошенный размер.
    hasMore: cursor ? members.length === take : skip + members.length < total,
    nextCursor: members.length > 0 ? members[members.length - 1].id : null,
  });
}
