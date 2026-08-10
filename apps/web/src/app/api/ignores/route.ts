import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * MODERATION: персональный игнор.
 *
 * GET    — список игнорируемых (только идентификаторы: чат сверяет их со
 *          списком авторов и большего от ответа не требует).
 * POST   — добавить, body { userId }.
 * DELETE — снять, ?userId=...
 *
 * Раньше список жил в `localStorage` вкладки. Это давало три неприятности:
 * он терялся при очистке браузера, не переезжал на другое устройство и не
 * действовал в десктоп-клиенте. Игнор — единственная защита обычного
 * участника, и терять её при переустановке браузера неправильно.
 *
 * Маршрут не групповой намеренно: игнорируют человека, а не его роль в
 * конкретном сообществе, и прятаться от него в одной группе, продолжая читать
 * в другой, никто не просил.
 */

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* Возвращаем и голые идентификаторы, и карточки пользователей.
     Идентификаторы нужны ленте: она прячет сообщения по `userId` и лишние поля
     ей ни к чему. Карточки нужны экрану управления списком — без имени и
     аватара там был бы столбец непонятных строк, из которого не догадаться,
     кого именно ты когда-то скрыл. */
  const rows = await prisma.userIgnore.findMany({
    where: { userId: session.user.id },
    select: {
      ignoredId: true,
      createdAt: true,
      ignored: { select: { id: true, name: true, username: true, avatar: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    ignored: rows.map((r) => r.ignoredId),
    users: rows.map((r) => ({
      id: r.ignored.id,
      name: r.ignored.name,
      username: r.ignored.username,
      avatar: r.ignored.avatar,
      since: r.createdAt,
    })),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : null;
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  if (userId === session.user.id) {
    return NextResponse.json({ error: "Нельзя игнорировать себя" }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  /* upsert, а не create: повторное нажатие на «Игнорировать» из второй вкладки
     не должно возвращать ошибку — для человека состояние уже то, которое он
     хотел. */
  await prisma.userIgnore.upsert({
    where: { userId_ignoredId: { userId: session.user.id, ignoredId: userId } },
    create: { userId: session.user.id, ignoredId: userId },
    update: {},
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  await prisma.userIgnore.deleteMany({
    where: { userId: session.user.id, ignoredId: userId },
  });

  return NextResponse.json({ ok: true });
}
