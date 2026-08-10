import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { logGroupAction } from "@/lib/groupAudit";
import { ROLE_RANK } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

/**
 * DELETE /api/groups/[id]/bans/[banId] — lift a ban.
 * Owner and admins can lift any ban; a moderator can only lift bans they issued.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; banId: string }> }) {
	const session = await getServerSession(authOptions);
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	// Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
	// токеном мог продолжать снимать баны с других пользователей.
	const banned = await checkBan(session.user.id);
	if (banned) return banned;

	const { id, banId } = await params;

	const membership = await prisma.groupMember.findUnique({
		where: { userId_groupId: { userId: session.user.id, groupId: id } },
	});

	const myRank = membership ? (ROLE_RANK[membership.role] ?? 0) : 0;
	if (myRank < ROLE_RANK.MODERATOR) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const ban = await prisma.groupBan.findUnique({
		where: { id: banId },
		include: { user: { select: { username: true } } },
	});

	if (!ban || ban.groupId !== id) {
		return NextResponse.json({ error: "Ban not found" }, { status: 404 });
	}

	if (myRank < ROLE_RANK.ADMIN && ban.bannedById !== session.user.id) {
		return NextResponse.json({ error: "Moderators can only lift their own bans" }, { status: 403 });
	}

	await prisma.groupBan.delete({ where: { id: banId } });

	await logAction({
		userId: session.user.id,
		username: session.user.username || session.user.name || "user",
		action: "update",
		target: "Group",
		targetId: id,
		details: `Разбан пользователя @${ban.user.username}`,
	});

	// NEW: запись в журнал аудита группы (вкладка «Аудит»)
	await logGroupAction({
		groupId: id,
		actorId: session.user.id,
		actorName: session.user.username || session.user.name || "user",
		action: "ban.remove",
		targetId: ban.userId,
		targetName: `@${ban.user.username}`,
	});

	return NextResponse.json({ ok: true });
}
