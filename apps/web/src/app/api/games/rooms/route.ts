import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { v4 as uuidv4 } from "uuid";
import { checkBan } from "@/lib/banCheck";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const { searchParams } = new URL(req.url);
  const browse = searchParams.get("browse");

  const isAdmin = ((session.user as { username?: string }).username || "").includes("acoulbot") ||
    (session.user as { role?: string }).role === "ADMIN";

  let rooms;
  if (browse === "all" && isAdmin) {
    // Admin: show ALL rooms
    rooms = await prisma.gameRoom.findMany({
      include: {
        host: { select: { id: true, name: true, username: true, avatar: true } },
        players: {
          include: {
            user: { select: { id: true, name: true, username: true, avatar: true } },
          },
        },
        _count: { select: { players: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  } else if (browse === "1") {
    // Only show rooms with activity in the last 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    rooms = await prisma.gameRoom.findMany({
      where: {
        status: "LOBBY",
        updatedAt: { gte: fiveMinAgo },
      },
      include: {
        host: { select: { id: true, name: true, username: true, avatar: true } },
        players: {
          include: {
            user: { select: { id: true, name: true, username: true, avatar: true } },
          },
        },
        _count: { select: { players: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  } else {
    rooms = await prisma.gameRoom.findMany({
      where: {
        OR: [
          { hostId: userId },
          { players: { some: { userId } } },
          { invites: { some: { inviteeId: userId, status: "PENDING" } } },
        ],
      },
      include: {
        host: { select: { id: true, name: true, username: true, avatar: true } },
        players: {
          include: {
            user: { select: { id: true, name: true, username: true, avatar: true } },
          },
        },
        _count: { select: { players: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  return NextResponse.json(rooms);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const banned = await checkBan(userId);
  if (banned) return banned;

  const { name, maxPlayers } = await req.json();

  // Generate a unique invite code with sufficient entropy (12 chars)
  let inviteCode: string;
  let attempts = 0;
  do {
    inviteCode = uuidv4().replace(/-/g, "").slice(0, 12);
    const existing = await prisma.gameRoom.findUnique({ where: { inviteCode } });
    if (!existing) break;
    attempts++;
  } while (attempts < 5);

  if (attempts >= 5) {
    return NextResponse.json({ error: "Failed to generate unique invite code, try again" }, { status: 500 });
  }

  const room = await prisma.gameRoom.create({
    data: {
      name: name || "Партия в Вельд'Эран",
      hostId: userId,
      maxPlayers: Math.min(Math.max(maxPlayers || 2, 2), 10),
      inviteCode,
      players: {
        create: {
          userId,
          turnOrder: 0,
        },
      },
    },
    include: {
      host: { select: { id: true, name: true, username: true, avatar: true } },
      players: {
        include: {
          user: { select: { id: true, name: true, username: true, avatar: true } },
        },
      },
    },
  });

  return NextResponse.json(room, { status: 201 });
}
