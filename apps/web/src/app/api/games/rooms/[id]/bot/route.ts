import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getBotUserId, getBotEmail, getBotUsername, getBotName } from "@/lib/games/velderanBot";
import bcrypt from "bcryptjs";

const FACTIONS = [
  "empire", "republic", "subbgars", "dwarves", "delions",
  "avains", "ancients", "trolls", "dark", "rebellion",
];

const FACTION_COLORS: Record<string, string> = {
  empire: "#ef4444", republic: "#3b82f6", subbgars: "#a855f7", dwarves: "#eab308",
  delions: "#525252", avains: "#f5f5f5", ancients: "#92400e", trolls: "#22c55e",
  dark: "#67e8f9", rebellion: "#9ca3af",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id } = await params;

  const room = await prisma.gameRoom.findUnique({
    where: { id },
    include: {
      players: true,
      _count: { select: { players: true } },
    },
  });

  if (!room) {
    return NextResponse.json({ error: "Комната не найдена" }, { status: 404 });
  }
  if (room.hostId !== userId) {
    return NextResponse.json({ error: "Только хост может добавлять ботов" }, { status: 403 });
  }
  if (room.status !== "LOBBY") {
    return NextResponse.json({ error: "Игра уже началась" }, { status: 400 });
  }
  if (room._count.players >= room.maxPlayers) {
    return NextResponse.json({ error: "Комната полна" }, { status: 400 });
  }

  // Find next bot index
  const existingBotIds = room.players
    .filter((p) => p.userId.startsWith("bot-velderan-"))
    .map((p) => {
      const num = parseInt(p.userId.replace("bot-velderan-", ""));
      return isNaN(num) ? 0 : num;
    });
  const nextIndex = existingBotIds.length > 0 ? Math.max(...existingBotIds) + 1 : 0;

  const botUserId = getBotUserId(nextIndex);
  const botEmail = getBotEmail(nextIndex);
  const botUsername = getBotUsername(nextIndex);
  const botName = getBotName(nextIndex);

  // Create bot user if doesn't exist
  let botUser = await prisma.user.findUnique({ where: { id: botUserId } });
  if (!botUser) {
    // Check unique constraints
    const existingEmail = await prisma.user.findUnique({ where: { email: botEmail } });
    const existingUsername = await prisma.user.findUnique({ where: { username: botUsername } });
    if (existingEmail || existingUsername) {
      // Use the existing user
      botUser = existingEmail || existingUsername;
    } else {
      const hashedPw = await bcrypt.hash(`bot-${Date.now()}-secret`, 10);
      botUser = await prisma.user.create({
        data: {
          id: botUserId,
          email: botEmail,
          username: botUsername,
          name: botName,
          password: hashedPw,
          emailVerified: true,
        },
      });
    }
  }

  // Pick a faction not taken
  const takenFactions = new Set(room.players.filter((p) => p.faction).map((p) => p.faction!));
  const availableFaction = FACTIONS.find((f) => !takenFactions.has(f)) || FACTIONS[0];
  const color = FACTION_COLORS[availableFaction] || "#ffffff";

  // Add bot as player
  const player = await prisma.gamePlayer.create({
    data: {
      roomId: id,
      userId: botUser!.id,
      faction: availableFaction,
      color,
      isReady: true,
      turnOrder: room._count.players,
    },
    include: {
      user: { select: { id: true, name: true, username: true, avatar: true } },
    },
  });

  return NextResponse.json(player, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id } = await params;
  const body = await req.json();
  const { botPlayerId } = body;

  const room = await prisma.gameRoom.findUnique({ where: { id } });
  if (!room) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (room.hostId !== userId) {
    return NextResponse.json({ error: "Только хост может удалять ботов" }, { status: 403 });
  }
  if (room.status !== "LOBBY") {
    return NextResponse.json({ error: "Игра уже началась" }, { status: 400 });
  }

  if (botPlayerId) {
    await prisma.gamePlayer.deleteMany({
      where: { roomId: id, id: botPlayerId, userId: { startsWith: "bot-velderan-" } },
    });
  }

  return NextResponse.json({ ok: true });
}
