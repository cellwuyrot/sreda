import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logGroupAction } from "@/lib/groupAudit";
import { emitToUsers } from "@/lib/socketEmit";
import { ROLE_RANK } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

// NEW: тайм-аут — промежуточная мера между киком и баном.
// POST   { minutes, reason? } — выдать тайм-аут (запрет отправки сообщений).
// DELETE — снять тайм-аут досрочно.
// Проверка при отправке сообщений: src/lib/moderation.ts (см. PATCHES.md).

const MAX_TIMEOUT_MINUTES = 40320; // 28 дней

async function groupMemberIds(groupId: string): Promise<string[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

type Ctx = { params: Promise<{ id: string; memberId: string }> };

async function checkPermissions(sessionUserId: string, groupId: string, memberId: string) {
  const myMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: sessionUserId, groupId } },
  });
  if (!myMembership) {
    return { error: NextResponse.json({ error: "Not a member" }, { status: 403 }) };
  }

  const myRank = ROLE_RANK[myMembership.role] ?? 0;
  if (myRank < ROLE_RANK.MODERATOR) {
    return { error: NextResponse.json({ error: "Only moderators can manage timeouts" }, { status: 403 }) };
  }

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    include: { user: { select: { id: true, name: true, username: true } } },
  });
  if (!target || target.groupId !== groupId) {
    return { error: NextResponse.json({ error: "Member not found" }, { status: 404 }) };
  }
  if (target.userId === sessionUserId) {
    return { error: NextResponse.json({ error: "Cannot timeout yourself" }, { status: 403 }) };
  }
  const targetRank = ROLE_RANK[target.role] ?? 0;
  if (targetRank >= myRank) {
    return { error: NextResponse.json({ error: "Cannot timeout member of equal or higher rank" }, { status: 403 }) };
  }

  return { target };
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать выдавать тайм-ауты другим участникам.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id, memberId } = await params;
  const { minutes, reason } = await req.json();

  if (typeof minutes !== "number" || minutes < 1 || minutes > MAX_TIMEOUT_MINUTES) {
    return NextResponse.json(
      { error: `minutes должен быть числом от 1 до ${MAX_TIMEOUT_MINUTES}` },
      { status: 400 },
    );
  }
  if (reason !== undefined && reason !== null && (typeof reason !== "string" || reason.length > 300)) {
    return NextResponse.json({ error: "Причина — строка до 300 символов" }, { status: 400 });
  }

  const check = await checkPermissions(session.user.id, id, memberId);
  if ("error" in check) return check.error;
  const target = check.target!;

  const mutedUntil = new Date(Date.now() + minutes * 60_000);

  await prisma.groupMember.update({
    where: { id: memberId },
    data: { mutedUntil, muteReason: reason?.trim() || null },
  });

  await logGroupAction({
    groupId: id,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "user",
    action: "member.timeout",
    targetId: target.user.id,
    targetName: target.user.username || target.user.name,
    details: `До ${mutedUntil.toISOString()}${reason ? ` — ${reason}` : ""}`,
  });

  emitToUsers(await groupMemberIds(id), "group-updated", { id });

  return NextResponse.json({ ok: true, mutedUntil });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать снимать тайм-ауты с других участников.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id, memberId } = await params;

  const check = await checkPermissions(session.user.id, id, memberId);
  if ("error" in check) return check.error;
  const target = check.target!;

  await prisma.groupMember.update({
    where: { id: memberId },
    data: { mutedUntil: null, muteReason: null },
  });

  await logGroupAction({
    groupId: id,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "user",
    action: "member.untimeout",
    targetId: target.user.id,
    targetName: target.user.username || target.user.name,
  });

  emitToUsers(await groupMemberIds(id), "group-updated", { id });

  return NextResponse.json({ ok: true });
}
