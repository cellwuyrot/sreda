import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * FIX-BOARDPICKER: список холстов для модалки выбора доски.
 *
 * GET /api/workspace/board-list?groupId=xxx
 *
 * Возвращает:
 *   personal.boards  — холсты личной рабочей среды
 *   group            — список canvas-каналов группы, каждый со своими холстами
 */

type BoardMeta = { id: string; name: string };

function parseBoards(raw: string | null | undefined): BoardMeta[] {
  if (!raw) return [{ id: "default", name: "Холст 1" }];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "boards" in parsed &&
      Array.isArray((parsed as { boards?: unknown }).boards)
    ) {
      const boards = (parsed as { boards: { id?: string; name?: string }[] }).boards;
      const result = boards
        .filter((b) => b.id)
        .map((b, i) => ({ id: b.id!, name: b.name || `Холст ${i + 1}` }));
      return result.length > 0 ? result : [{ id: "default", name: "Холст 1" }];
    }
  } catch {
    /* malformed JSON */
  }
  return [{ id: "default", name: "Холст 1" }];
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");

  // Холсты личной рабочей среды
  const personalState = await prisma.workspaceState.findUnique({
    where: { userId: session.user.id },
    select: { data: true },
  });
  const personalBoards = parseBoards(personalState?.data);

  // Групповые canvas-каналы
  let group: Array<{ channelId: string; channelName: string; boards: BoardMeta[] }> = [];
  if (groupId) {
    const canvasChannels = await prisma.channel.findMany({
      where: { groupId, type: "CANVAS" },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });

    const states = await prisma.channelWorkspaceState.findMany({
      where: { channelId: { in: canvasChannels.map((c) => c.id) } },
      select: { channelId: true, data: true },
    });
    const stateMap = new Map(states.map((s) => [s.channelId, s.data]));

    group = canvasChannels.map((ch) => ({
      channelId: ch.id,
      channelName: ch.name,
      boards: parseBoards(stateMap.get(ch.id)),
    }));
  }

  return NextResponse.json({
    personal: { boards: personalBoards },
    group,
  });
}
