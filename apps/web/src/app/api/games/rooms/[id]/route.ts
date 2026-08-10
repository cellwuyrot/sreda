import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createInitialState, getCurrentPlayerId, VelderanGameState } from "@/lib/games/velderanState";
import { executeBotTurns, isBotPlayer } from "@/lib/games/velderanBot";
import { loadMapConfigFromFiles } from "@/lib/games/velderanMapServer";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const room = await prisma.gameRoom.findUnique({
    where: { id },
    include: {
      host: { select: { id: true, name: true, username: true, avatar: true } },
      players: {
        include: {
          user: { select: { id: true, name: true, username: true, avatar: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
      invites: {
        where: { status: "PENDING" },
        include: {
          invitee: { select: { id: true, name: true, username: true, avatar: true } },
        },
      },
    },
  });

  if (!room) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = (session.user as { id: string }).id;
  const isPlayer = room.players.some((p) => p.user.id === userId);
  const isHost = room.host.id === userId;
  const isInvited = room.invites.some((inv) => inv.invitee.id === userId);
  const isAdmin = (session.user as { role: string }).role === "ADMIN";

  const isLobby = room.status === "LOBBY";
  if (!isPlayer && !isHost && !isInvited && !isAdmin && !isLobby) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(room);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const body = await req.json();
  const { id } = await params;

  const room = await prisma.gameRoom.findUnique({ where: { id } });
  if (!room) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (body.action === "start") {
    if (room.hostId !== userId) {
      return NextResponse.json({ error: "Только хост может начать игру" }, { status: 403 });
    }
    const players = await prisma.gamePlayer.findMany({ where: { roomId: id } });
    const allReady = players.length >= 2 && players.every((p) => p.isReady || p.userId === userId);
    if (!allReady) {
      return NextResponse.json({ error: "Не все игроки готовы" }, { status: 400 });
    }
    const playersData = players.map((p) => ({
      id: p.id,
      faction: p.faction || "empire",
      turnOrder: p.turnOrder,
    }));
    loadMapConfigFromFiles();
    let initialState: VelderanGameState = createInitialState(playersData);

    // If the first player is a bot, auto-play their turns
    const botPlayerIds = new Set(
      players.filter((p) => isBotPlayer(p.userId)).map((p) => p.id)
    );
    if (botPlayerIds.size > 0) {
      const playerNames: Record<string, string> = {};
      for (const p of players) {
        playerNames[p.id] = p.faction || p.id;
      }
      // Load actual names
      const users = await prisma.user.findMany({
        where: { id: { in: players.map((p) => p.userId) } },
        select: { id: true, name: true },
      });
      for (const p of players) {
        const u = users.find((u) => u.id === p.userId);
        if (u) playerNames[p.id] = u.name;
      }

      const firstId = getCurrentPlayerId(initialState);
      if (botPlayerIds.has(firstId)) {
        initialState = executeBotTurns(initialState, playerNames, botPlayerIds);
      }
    }

    const updated = await prisma.gameRoom.update({
      where: { id },
      data: {
        status: "PLAYING",
        gameState: JSON.stringify(initialState),
      },
    });
    return NextResponse.json(updated);
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

  const room = await prisma.gameRoom.findUnique({ where: { id } });
  if (!room) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (room.hostId !== userId && (session.user as { role: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.gameRoom.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
