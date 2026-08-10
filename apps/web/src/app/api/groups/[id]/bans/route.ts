import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { logGroupAction } from "@/lib/groupAudit";
import { emitToUsers, revokeGroupSession } from "@/lib/socketEmit";
import { ROLE_RANK } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

async function groupMemberIds(groupId: string): Promise<string[]> {
	const members = await prisma.groupMember.findMany({
		where: { groupId },
		select: { userId: true },
	});
	return members.map((m) => m.userId);
}

/** GET /api/groups/[id]/bans — list banned users (OWNER / ADMIN / MODERATOR). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const session = await getServerSession(authOptions);
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const membership = await prisma.groupMember.findUnique({
		where: { userId_groupId: { userId: session.user.id, groupId: id } },
	});

	if (!membership || (ROLE_RANK[membership.role] ?? 0) < ROLE_RANK.MODERATOR) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// НОВОЕ: оборачиваем в try/catch — если таблица банов ещё не создана
	// миграцией, клиент получит понятную ошибку, а не вечную «загрузку».
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
		return NextResponse.json(
			{ error: "Не удалось загрузить список забаненных. Проверьте, что миграции БД применены (npx prisma migrate deploy)." },
			{ status: 500 },
		);
	}
}

/**
 * POST /api/groups/[id]/bans
 * Body: { userId: string; reason?: string }
 *
 * Bans a user from the group: removes their membership (if any) and blocks
 * re-joining through invites until the ban is lifted.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const session = await getServerSession(authOptions);
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	// Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
	// токеном мог продолжать банить других участников группы.
	const banned = await checkBan(session.user.id);
	if (banned) return banned;

	const { id } = await params;
	const { userId, reason } = await req.json();

	if (!userId || typeof userId !== "string") {
		return NextResponse.json({ error: "userId required" }, { status: 400 });
	}

	if (userId === session.user.id) {
		return NextResponse.json({ error: "Cannot ban yourself" }, { status: 400 });
	}

	const membership = await prisma.groupMember.findUnique({
		where: { userId_groupId: { userId: session.user.id, groupId: id } },
	});

	const myRank = membership ? (ROLE_RANK[membership.role] ?? 0) : 0;
	if (myRank < ROLE_RANK.MODERATOR) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const group = await prisma.group.findUnique({
		where: { id },
		select: { id: true, name: true, ownerId: true, channels: { select: { id: true } } },
	});
	if (!group) {
		return NextResponse.json({ error: "Group not found" }, { status: 404 });
	}

	if (userId === group.ownerId) {
		return NextResponse.json({ error: "Cannot ban the owner" }, { status: 403 });
	}

	// If the target is still a member, respect the role hierarchy.
	const targetMembership = await prisma.groupMember.findUnique({
		where: { userId_groupId: { userId, groupId: id } },
	});
	if (targetMembership && (ROLE_RANK[targetMembership.role] ?? 0) >= myRank) {
		return NextResponse.json({ error: "Cannot ban a member of equal or higher rank" }, { status: 403 });
	}

	const targetUser = await prisma.user.findUnique({
		where: { id: userId },
		select: { id: true, username: true },
	});
	if (!targetUser) {
		return NextResponse.json({ error: "User not found" }, { status: 404 });
	}

	// Capture member ids before the kick so the banned user gets the update too.
	const memberIds = await groupMemberIds(id);

	const cleanReason = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 300) : null;

	// НОВОЕ: атомарная транзакция + понятная ошибка. Если запись бана невозможна
	// (например, таблица не создана миграцией), откатывается и исключение
	// участника — больше не будет ситуации «ошибка есть, а бан вроде выдан».
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
		return NextResponse.json(
			{ error: "Не удалось выдать бан: база данных не содержит таблицу банов или недоступна. Примените миграции: npx prisma migrate deploy" },
			{ status: 500 },
		);
	}

	await logAction({
		userId: session.user.id,
		username: session.user.username || session.user.name || "user",
		action: "update",
		target: "Group",
		targetId: id,
		details: `Бан пользователя @${targetUser.username} в группе "${group.name}"${cleanReason ? ` (причина: ${cleanReason})` : ""}`,
	});

	// NEW: запись в журнал аудита группы (вкладка «Аудит»)
	await logGroupAction({
		groupId: id,
		actorId: session.user.id,
		actorName: session.user.username || session.user.name || "user",
		action: "ban.add",
		targetId: userId,
		targetName: `@${targetUser.username}`,
		details: cleanReason ? `Причина: ${cleanReason}` : undefined,
	});

	emitToUsers(memberIds, "group-updated", { id });
	revokeGroupSession(
		userId,
		id,
		group.channels.map((channel) => channel.id),
		{ groupId: id, groupName: group.name, channelIds: group.channels.map((channel) => channel.id), reason: cleanReason },
	);

	return NextResponse.json({ ok: true });
}
