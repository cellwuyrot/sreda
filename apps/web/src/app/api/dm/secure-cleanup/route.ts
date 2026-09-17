import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * Одноразовые (эфемерные) зашифрованные чаты.
 *
 * POST — удалить все SECURE-разговоры текущего пользователя.
 *        Вызывается при закрытии вкладки (navigator.sendBeacon) и при
 *        размонтировании DMPanel, чтобы разговор точно не пережил сессию.
 *
 * DELETE — то же самое, но для конкретного conversationId (query param ?id=...).
 *          Используется при явном выходе из зашифрованного чата.
 */

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  const userId = session.user.id;

  try {
    // Находим все SECURE-разговоры пользователя
    const secureConvs = await prisma.directConversation.findMany({
      where: {
        kind: "SECURE",
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      select: { id: true },
    });

    if (secureConvs.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }

    const ids = secureConvs.map((c) => c.id);

    // Удаляем сообщения, затем разговоры (cascade может не работать без явного порядка)
    await prisma.directMessage.deleteMany({
      where: { conversationId: { in: ids } },
    });

    await prisma.directConversation.deleteMany({
      where: { id: { in: ids } },
    });

    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (err) {
    console.error("[secure-cleanup] error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  const userId = session.user.id;
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    const conv = await prisma.directConversation.findFirst({
      where: {
        id,
        kind: "SECURE",
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      select: { id: true },
    });

    if (!conv) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }

    await prisma.directMessage.deleteMany({ where: { conversationId: id } });
    await prisma.directConversation.delete({ where: { id } });

    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (err) {
    console.error("[secure-cleanup/delete] error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
