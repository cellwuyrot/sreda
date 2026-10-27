import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * Одноразовые (эфемерные) зашифрованные чаты.
 *
 * POST — отклонить устаревший массовый beacon без удаления данных.
 * Закрытие вкладки не является намерением удалить переписку на всех устройствах.
 *
 * DELETE — удалить конкретный SECURE-разговор (?id=...).
 */

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  // Older clients send an unscoped beacon on every navigation. Never let
  // that destroy conversations still in use on other devices.
  return NextResponse.json({ error: "Use explicit DELETE with a conversation id" }, { status: 409 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });
  const userId = session.user.id;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const conv = await prisma.directConversation.findFirst({
      where: { id, kind: "SECURE", OR: [{ user1Id: userId }, { user2Id: userId }] },
      select: { id: true },
    });
    if (!conv) return NextResponse.json({ ok: true, deleted: 0 });
    await prisma.$transaction([
      prisma.directMessage.deleteMany({ where: { conversationId: id } }),
      prisma.directConversation.delete({ where: { id } }),
    ]);
    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (err) {
    console.error("[secure-cleanup/delete]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
