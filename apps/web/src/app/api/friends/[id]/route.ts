import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { emitToUser } from "@/lib/socketEmit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { action } = await req.json();
  const { id } = await params;

  const friendship = await prisma.friendship.findUnique({ where: { id } });
  if (!friendship) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "accept") {
    if (friendship.receiverId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const updated = await prisma.friendship.update({
      where: { id },
      data: { status: "ACCEPTED" },
    });
    // Оба участника должны увидеть обновлённый список немедленно
    emitToUser(friendship.senderId, "friends-updated", {});
    emitToUser(friendship.receiverId, "friends-updated", {});
    return NextResponse.json(updated);
  }

  if (action === "decline") {
    if (friendship.receiverId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await prisma.friendship.delete({ where: { id } });
    // Отправитель видит, что запрос отклонён, получатель — что он исчез из входящих
    emitToUser(friendship.senderId, "friends-updated", {});
    emitToUser(friendship.receiverId, "friends-updated", {});
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id } = await params;

  const friendship = await prisma.friendship.findUnique({ where: { id } });
  if (!friendship) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (friendship.senderId !== userId && friendship.receiverId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.friendship.delete({ where: { id } });
  // Оба участника получают сигнал: дружба удалена
  emitToUser(friendship.senderId, "friends-updated", {});
  emitToUser(friendship.receiverId, "friends-updated", {});
  return NextResponse.json({ ok: true });
}
