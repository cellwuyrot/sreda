import { NextResponse, NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const unreadOnly = searchParams.get("unread") === "true";

  const where: Record<string, unknown> = { userId: session.user.id };
  if (type) where.type = type;
  if (unreadOnly) where.read = false;

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const unreadCount = await prisma.notification.count({
    where: { userId: session.user.id, read: false },
  });

  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  if (body.markAllRead) {
    await prisma.notification.updateMany({
      where: { userId: session.user.id, read: false },
      data: { read: true },
    });
    return NextResponse.json({ success: true, unreadCount: 0 });
  }

  /* Пометка по предмету: нажали на сгруппированное уведомление беседы — гаснут
     все её непрочитанные записи, а не только та, по которой кликнули. Раньше
     помечалась ровно одна строка, и остальные уведомления того же чата
     оставались непрочитанными («залипший» бейдж). Предмет приходит с клиента, но
     сузить его до своих записей — обязанность сервера. */
  if (body.entityType && body.entityId) {
    await prisma.notification.updateMany({
      where: {
        userId: session.user.id,
        read: false,
        entityType: body.entityType,
        entityId: body.entityId,
      },
      data: { read: true },
    });
    const unreadCount = await prisma.notification.count({
      where: { userId: session.user.id, read: false },
    });
    return NextResponse.json({ success: true, unreadCount });
  }

  if (body.id) {
    // Scope by userId so a user can only mark their own notifications read.
    const result = await prisma.notification.updateMany({
      where: { id: body.id, userId: session.user.id },
      data: { read: true },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const unreadCount = await prisma.notification.count({
      where: { userId: session.user.id, read: false },
    });
    return NextResponse.json({ success: true, unreadCount });
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  if (body.deleteAll) {
    await prisma.notification.deleteMany({
      where: { userId: session.user.id },
    });
    return NextResponse.json({ success: true });
  }

  if (body.id) {
    // Scope by userId so a user can only delete their own notifications.
    const result = await prisma.notification.deleteMany({
      where: { id: body.id, userId: session.user.id },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}
