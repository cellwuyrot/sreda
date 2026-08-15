import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { createNotification } from "@/lib/createNotification";

/**
 * PROFILE-WALL: подписка на человека.
 *
 *   POST   — подписаться
 *   DELETE — отписаться
 *
 * Оба действия идемпотентны и возвращают одинаково устроенный ответ со свежими
 * счётчиками: кнопка на клиенте не должна считать подписчиков сама — два окна
 * одного человека тут же разойдутся в показаниях.
 *
 * Повторное нажатие не ошибка: уникальность пары держит база, а сообщать человеку
 * «вы уже подписаны» в ответ на желание быть подписанным — шум без пользы.
 */

async function counters(targetId: string, viewerId: string) {
  const [followers, following, mine] = await Promise.all([
    prisma.follow.count({ where: { followingId: targetId } }),
    prisma.follow.count({ where: { followerId: targetId } }),
    prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: viewerId, followingId: targetId } },
      select: { id: true },
    }),
  ]);
  return { followers, following, isFollowing: !!mine };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: targetId } = await params;
  return NextResponse.json(await counters(targetId, session.user.id));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  /* Подписка создаёт уведомление у чужого человека, то есть это способ ему
     писать. Без ограничения «подписаться/отписаться» в цикле даёт поток тостов. */
  const limited = await rateLimit(req, "follow", { limit: 60, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const { id: targetId } = await params;
  if (targetId === session.user.id) {
    return NextResponse.json({ error: "Нельзя подписаться на себя" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, username: true },
  });
  if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  /* Чёрный список в любую сторону закрывает подписку: иначе заблокированный
     продолжал бы читать чужую стену и появляться в списке подписчиков того, кто
     от него закрылся. */
  const ignore = await prisma.userIgnore.findFirst({
    where: {
      OR: [
        { userId: targetId, ignoredId: session.user.id },
        { userId: session.user.id, ignoredId: targetId },
      ],
    },
    select: { id: true },
  });
  if (ignore) {
    return NextResponse.json({ error: "Подписка недоступна" }, { status: 403 });
  }

  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: session.user.id, followingId: targetId } },
    select: { id: true },
  });

  if (!existing) {
    await prisma.follow.create({
      data: { followerId: session.user.id, followingId: targetId },
    });
    /* Уведомляем только о НОВОЙ подписке. Повторное нажатие из соседней
       вкладки не должно выглядеть как второй человек. */
    await createNotification({
      userId: targetId,
      type: "follow",
      title: "Новый подписчик",
      body: `${session.user.name || session.user.username} подписался на ваши записи`,
      link: `/profile/${session.user.username}`,
      actorId: session.user.id,
      entityType: "follow",
      entityId: session.user.id,
    });
  }

  return NextResponse.json(await counters(targetId, session.user.id));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: targetId } = await params;
  /* deleteMany, а не delete: отписка от того, на кого уже не подписан, — это тот
     же желаемый итог, а не ошибка 500 из-за отсутствующей строки. */
  await prisma.follow.deleteMany({
    where: { followerId: session.user.id, followingId: targetId },
  });

  return NextResponse.json(await counters(targetId, session.user.id));
}
