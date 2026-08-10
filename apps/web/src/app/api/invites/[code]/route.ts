import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logGroupAction } from "@/lib/groupAudit";
import { emitToUsers } from "@/lib/socketEmit";
import { checkBan } from "@/lib/banCheck";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const invite = await prisma.invite.findUnique({
    where: { code },
    include: {
      group: {
        select: { id: true, name: true, icon: true, description: true, _count: { select: { members: true } } },
      },
    },
  });

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
    return NextResponse.json({ error: "Invite limit reached" }, { status: 410 });
  }

  return NextResponse.json({
    code: invite.code,
    group: invite.group,
    expiresAt: invite.expiresAt,
  });
}

export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог вступать в группы по приглашению, несмотря на бан.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { code } = await params;
  const invite = await prisma.invite.findUnique({
    where: { code },
    include: { group: true },
  });

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
    return NextResponse.json({ error: "Invite limit reached" }, { status: 410 });
  }

  const existing = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: invite.groupId } },
  });

  if (existing) {
    return NextResponse.json({ error: "Already a member", groupId: invite.groupId }, { status: 409 });
  }

  // Banned users cannot re-join the group through invites.
  const ban = await prisma.groupBan.findUnique({
    where: { groupId_userId: { groupId: invite.groupId, userId: session.user.id } },
  });

  if (ban) {
    return NextResponse.json({ error: "Вы заблокированы в этой группе" }, { status: 403 });
  }

  await prisma.$transaction([
    prisma.groupMember.create({
      data: { userId: session.user.id, groupId: invite.groupId },
    }),
    prisma.invite.update({
      where: { code },
      data: { uses: { increment: 1 } },
    }),
  ]);

  // The new member (any open session) and the existing members should all see
  // the group / updated member list appear without a manual reload.
  const members = await prisma.groupMember.findMany({
    where: { groupId: invite.groupId },
    select: { userId: true },
  });
  emitToUsers(members.map((m) => m.userId), "group-updated", { id: invite.groupId });

  return NextResponse.json({ ok: true, groupId: invite.groupId });
}

// NEW: отзыв (удаление) приглашения. Доступно модераторам и выше.
// Закрывает дыру: раньше утёкшую ссылку невозможно было погасить.
export async function DELETE(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать отзывать приглашения группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { code } = await params;
  const invite = await prisma.invite.findUnique({ where: { code } });

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: invite.groupId } },
  });

  const canModerate =
    !!membership && ["OWNER", "ADMIN", "MODERATOR"].includes(membership.role);

  if (!canModerate) {
    return NextResponse.json({ error: "Only moderators can revoke invites" }, { status: 403 });
  }

  await prisma.invite.delete({ where: { code } });

  await logGroupAction({
    groupId: invite.groupId,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "user",
    action: "invite.revoke",
    targetId: code,
    details: `Отозвано приглашение ${code} (использований: ${invite.uses})`,
  });

  return NextResponse.json({ ok: true });
}
