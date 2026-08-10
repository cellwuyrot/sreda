import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { emitToUser } from "@/lib/socketEmit";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { senderId: userId, status: "ACCEPTED" },
        { receiverId: userId, status: "ACCEPTED" },
      ],
    },
    include: {
      sender: { select: { id: true, name: true, username: true, avatar: true, role: true, lastSeen: true, avatarGlowEnabled: true, avatarGlowColors: true } },
      receiver: { select: { id: true, name: true, username: true, avatar: true, role: true, lastSeen: true, avatarGlowEnabled: true, avatarGlowColors: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const friends = friendships.map((f) => {
    const friend = f.senderId === userId ? f.receiver : f.sender;
    return { ...friend, friendshipId: f.id };
  });

  const pending = await prisma.friendship.findMany({
    where: { receiverId: userId, status: "PENDING" },
    include: {
      sender: { select: { id: true, name: true, username: true, avatar: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const sent = await prisma.friendship.findMany({
    where: { senderId: userId, status: "PENDING" },
    include: {
      receiver: { select: { id: true, name: true, username: true, avatar: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ friends, pending, sent });
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "friends", { limit: 20, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const banned = await checkBan(userId);
  if (banned) return banned;

  const { username } = await req.json();

  if (!username) {
    return NextResponse.json({ error: "Username required" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { username } });
  if (!target) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }
  if (target.id === userId) {
    return NextResponse.json({ error: "Нельзя добавить себя" }, { status: 400 });
  }

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { senderId: userId, receiverId: target.id },
        { senderId: target.id, receiverId: userId },
      ],
    },
  });

  if (existing) {
    if (existing.status === "ACCEPTED") {
      return NextResponse.json({ error: "Уже в друзьях" }, { status: 400 });
    }
    if (existing.status === "PENDING") {
      return NextResponse.json({ error: "Запрос уже отправлен" }, { status: 400 });
    }
  }

  const friendship = await prisma.friendship.create({
    data: { senderId: userId, receiverId: target.id },
    include: {
      receiver: { select: { id: true, name: true, username: true, avatar: true } },
    },
  });

  // Уведомляем получателя запроса, чтобы его панель обновилась мгновенно
  emitToUser(target.id, "friends-updated", {});

  return NextResponse.json(friendship, { status: 201 });
}
