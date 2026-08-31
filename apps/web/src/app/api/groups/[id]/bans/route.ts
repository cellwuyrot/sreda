import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { logGroupAction } from "@/lib/groupAudit";
import { emitToUsers, revokeGroupSession } from "@/lib/socketEmit";
import { emitToChannel } from "@/lib/socketEmit";
import { ROLE_RANK, effectiveRank } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

async function groupMemberIds(groupId: string): Promise<string[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/** GET /api/groups/[id]/bans */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });
  if (!membership || effectiveRank(membership) < ROLE_RANK.MODERATOR) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const bans = await prisma.groupBan.findMany({
      where: { groupId: id },
      include: {
        user: { select: { id: true, name: true, username: true, avatar: true, role: true } },
        bannedBy: { select: { id: true, name: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(bans);
  } catch (e) {
    console.error("GET /bans failed:", e);
    return NextResponse.json({ error: "Не удалось загрузить список забаненных" }, { status: 500 });
  }
}

/**
 * POST /api/groups/[id]/bans
 * Body: {
 *   userId?: string;          // userId напрямую
 *   username?: string;         // @ник (альтернатива userId, @ необязателен)
 *   reason?: string;           // пользовательская причина
 *   reasonPreset?: "AD" | "SPAM" | "FRAUD";  // пресет причины
 *   deleteMessages?: boolean;  // удалить все сообщения пользователя в группе
 * }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const body = await req.json();

  let { userId } = body as { userId?: string };
  const { username, reason, reasonPreset, deleteMessages } = body as {
    username?: string;
    reason?: string;
    reasonPreset?: string;
    deleteMessages?: boolean;
  };

  // Resolve userId from username if needed
  if (!userId && username) {
    const uname = username.replace(/^@/, "").trim();
    if (!uname) return NextResponse.json({ error: "Укажите @ник пользователя" }, { status: 400 });
    const found = await prisma.user.findFirst({
      where: { username: { equals: uname, mode: "insensitive" } },
      select: { id: true },
    });
    if (!found) return NextResponse.json({ error: `Пользователь @${uname} не найден` }, { status: 404 });
    userId = found.id;
  }

  if (!userId) return NextResponse.json({ error: "userId или username обязателен" }, { status: 400 });
  if (userId === session.user.id) return NextResponse.json({ error: "Нельзя забанить себя" }, { status: 400 });

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });
  const myRank = membership ? effectiveRank(membership) : 0;
  if (myRank < ROLE_RANK.GUIDE) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = await prisma.group.findUnique({
    where: { id },
    select: { id: true, name: true, ownerId: true, channels: { select: { id: true } } },
  });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (userId === group.ownerId) return NextResponse.json({ error: "Нельзя забанить владельца" }, { status: 403 });

  const targetMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: id } },
  });
  if (targetMembership && effectiveRank(targetMembership) >= myRank) {
    return NextResponse.json({ error: "Нельзя забанить участника равного или старшего ранга" }, { status: 403 });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  });
  if (!targetUser) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  const REASON_PRESETS: Record<string, string> = {
    AD:    "Реклама",
    SPAM:  "Спам",
    FRAUD: "Мошенничество",
  };

  let cleanReason: string | null = null;
  if (reasonPreset && REASON_PRESETS[reasonPreset]) {
    cleanReason = REASON_PRESETS[reasonPreset];
  } else if (typeof reason === "string" && reason.trim()) {
    cleanReason = reason.trim().slice(0, 300);
  }

  const memberIds = await groupMemberIds(id);

  try {
    await prisma.$transaction([
      ...(targetMembership ? [prisma.groupMember.delete({ where: { id: targetMembership.id } })] : []),
      prisma.groupBan.upsert({
        where: { groupId_userId: { groupId: id, userId } },
        create: { groupId: id, userId, reason: cleanReason, bannedById: session.user.id },
        update: { reason: cleanReason, bannedById: session.user.id },
      }),
    ]);
  } catch (e) {
    console.error("POST /bans failed:", e);
    return NextResponse.json({ error: "Не удалось выдать бан" }, { status: 500 });
  }

  // Delete all user messages in this group if requested
  let deletedCount = 0;
  if (deleteMessages) {
    try {
      const channelIds = group.channels.map((c) => c.id);
      const doomed = await prisma.message.findMany({
        where: { userId, channelId: { in: channelIds } },
        select: { id: true, channelId: true },
      });
      if (doomed.length > 0) {
        await prisma.message.deleteMany({ where: { id: { in: doomed.map((m) => m.id) } } });
        deletedCount = doomed.length;
        for (const m of doomed) {
          emitToChannel(m.channelId, "message-deleted", { id: m.id, channelId: m.channelId });
        }
      }
    } catch (e) {
      console.error("deleteMessages failed (non-fatal):", e);
    }
  }

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "user",
    action: "update",
    target: "Group",
    targetId: id,
    details: `Бан @${targetUser.username} в группе "${group.name}"${cleanReason ? ` (${cleanReason})` : ""}${deleteMessages ? `, удалено сообщений: ${deletedCount}` : ""}`,
  });

  await logGroupAction({
    groupId: id,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "user",
    action: "ban.add",
    targetId: userId,
    targetName: `@${targetUser.username}`,
    details: [cleanReason, deleteMessages ? `удалено сообщений: ${deletedCount}` : null].filter(Boolean).join(" · ") || undefined,
  });

  emitToUsers(memberIds, "group-updated", { id });
  revokeGroupSession(
    userId,
    id,
    group.channels.map((c) => c.id),
    { groupId: id, groupName: group.name, channelIds: group.channels.map((c) => c.id), reason: cleanReason },
  );

  return NextResponse.json({ ok: true, deletedMessages: deletedCount });
}
