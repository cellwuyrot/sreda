import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id } = await params;

  const room = await prisma.gameRoom.findUnique({
    where: { id },
    include: { _count: { select: { players: true } } },
  });
  if (!room) {
    return NextResponse.json({ error: "Комната не найдена" }, { status: 404 });
  }
  if (room.status !== "LOBBY") {
    return NextResponse.json({ error: "Игра уже началась" }, { status: 400 });
  }

  const alreadyIn = await prisma.gamePlayer.findUnique({
    where: { roomId_userId: { roomId: id, userId } },
  });
  if (alreadyIn) {
    return NextResponse.json({ error: "Вы уже в комнате" }, { status: 400 });
  }

  if (room._count.players >= room.maxPlayers) {
    return NextResponse.json({ error: "Комната полна" }, { status: 400 });
  }

  const player = await prisma.gamePlayer.create({
    data: {
      roomId: id,
      userId,
      turnOrder: room._count.players,
    },
    include: {
      user: { select: { id: true, name: true, username: true, avatar: true } },
    },
  });

  return NextResponse.json(player, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const body = await req.json();
  const { id } = await params;

  const player = await prisma.gamePlayer.findUnique({
    where: { roomId_userId: { roomId: id, userId } },
  });
  if (!player) {
    return NextResponse.json({ error: "Вы не в этой комнате" }, { status: 403 });
  }

  const room = await prisma.gameRoom.findUnique({ where: { id } });
  if (!room || room.status !== "LOBBY") {
    return NextResponse.json({ error: "Комната не в режиме лобби" }, { status: 400 });
  }

  if (body.faction !== undefined) {
    if (body.faction) {
      const taken = await prisma.gamePlayer.findFirst({
        where: { roomId: id, faction: body.faction, NOT: { userId } },
      });
      if (taken) {
        return NextResponse.json({ error: "Фракция уже занята" }, { status: 400 });
      }
    }
    await prisma.gamePlayer.update({
      where: { id: player.id },
      data: { faction: body.faction || null, color: body.color || null },
    });
  }

  if (body.isReady !== undefined) {
    if (!player.faction && body.isReady) {
      return NextResponse.json({ error: "Сначала выберите фракцию" }, { status: 400 });
    }
    await prisma.gamePlayer.update({
      where: { id: player.id },
      data: { isReady: body.isReady },
    });
  }

  const updated = await prisma.gamePlayer.findUnique({
    where: { id: player.id },
    include: { user: { select: { id: true, name: true, username: true, avatar: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id } = await params;

  const room = await prisma.gameRoom.findUnique({ where: { id } });
  if (!room) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (room.hostId === userId) {
    return NextResponse.json({ error: "Хост не может покинуть комнату" }, { status: 400 });
  }

  await prisma.gamePlayer.deleteMany({
    where: { roomId: id, userId },
  });

  return NextResponse.json({ ok: true });
}
