import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createNotification } from "@/lib/createNotification";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { roomId, inviteeId } = await req.json();

  const room = await prisma.gameRoom.findUnique({
    where: { id: roomId },
    include: { _count: { select: { players: true } } },
  });
  if (!room || room.status !== "LOBBY") {
    return NextResponse.json({ error: "Комната не найдена или игра уже идёт" }, { status: 400 });
  }

  const isFriend = await prisma.friendship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { senderId: userId, receiverId: inviteeId },
        { senderId: inviteeId, receiverId: userId },
      ],
    },
  });
  if (!isFriend) {
    return NextResponse.json({ error: "Можно приглашать только друзей" }, { status: 403 });
  }

  const alreadyInRoom = await prisma.gamePlayer.findUnique({
    where: { roomId_userId: { roomId, userId: inviteeId } },
  });
  if (alreadyInRoom) {
    return NextResponse.json({ error: "Игрок уже в комнате" }, { status: 400 });
  }

  if (room._count.players >= room.maxPlayers) {
    return NextResponse.json({ error: "Комната полна" }, { status: 400 });
  }

  const invite = await prisma.gameInvite.upsert({
    where: { roomId_inviteeId: { roomId, inviteeId } },
    create: { roomId, inviterId: userId, inviteeId },
    update: { status: "PENDING", inviterId: userId },
    include: {
      invitee: { select: { id: true, name: true, username: true, avatar: true } },
    },
  });

  const senderName = (session.user as { name?: string }).name || "Игрок";
  createNotification({
    userId: inviteeId,
    type: "game_invite",
    title: `${senderName} приглашает вас в игру`,
    body: `Комната: ${room.name}`,
    link: "/games/velderan",
  }).catch(() => {});

  return NextResponse.json(invite, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { inviteId, action } = await req.json();

  const invite = await prisma.gameInvite.findUnique({
    where: { id: inviteId },
    include: { room: { include: { _count: { select: { players: true } } } } },
  });
  if (!invite || invite.inviteeId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "accept") {
    if (invite.room.status !== "LOBBY") {
      return NextResponse.json({ error: "Игра уже началась" }, { status: 400 });
    }

    // Use an interactive transaction to atomically re-check the player count and join
    try {
      await prisma.$transaction(async (tx) => {
        const currentCount = await tx.gamePlayer.count({ where: { roomId: invite.roomId } });
        if (currentCount >= invite.room.maxPlayers) {
          throw new Error("ROOM_FULL");
        }
        await tx.gameInvite.update({
          where: { id: inviteId },
          data: { status: "ACCEPTED" },
        });
        await tx.gamePlayer.create({
          data: {
            roomId: invite.roomId,
            userId,
            turnOrder: currentCount,
          },
        });
      });
    } catch (e) {
      if (e instanceof Error && e.message === "ROOM_FULL") {
        return NextResponse.json({ error: "Комната полна" }, { status: 400 });
      }
      throw e;
    }

    return NextResponse.json({ ok: true });
  }

  if (action === "decline") {
    await prisma.gameInvite.update({
      where: { id: inviteId },
      data: { status: "DECLINED" },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const room = await prisma.gameRoom.findUnique({
      where: { inviteCode: code },
      include: {
        host: { select: { id: true, name: true, username: true, avatar: true } },
        players: {
          include: { user: { select: { id: true, name: true, username: true, avatar: true } } },
        },
        _count: { select: { players: true } },
      },
    });
    if (!room) {
      return NextResponse.json({ error: "Комната не найдена" }, { status: 404 });
    }

    return NextResponse.json(room);
  }

  const invites = await prisma.gameInvite.findMany({
    where: { inviteeId: userId, status: "PENDING" },
    include: {
      room: {
        include: {
          host: { select: { id: true, name: true, username: true, avatar: true } },
          _count: { select: { players: true } },
        },
      },
      inviter: { select: { id: true, name: true, username: true, avatar: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(invites);
}
