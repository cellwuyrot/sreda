import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { emitToChannel, emitToUser } from "@/lib/socketEmit";
import { isUserViewingChannel } from "@/lib/presence";
import { createNotification, createNotificationsBulk } from "@/lib/createNotification";
import { getActiveTimeout } from "@/lib/moderation";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { messageLengthError } from "@/lib/messageLimits";
import { hasPremium } from "@/lib/premium";
import { checkCensor, recordCensorHits } from "@/lib/censorService";
import { logGroupAction } from "@/lib/groupAudit";
import { canActOn, rankOf, RANK_MODERATOR } from "@/lib/groupModeration";

const MESSAGE_SELECT = {
	user: {
		select: {
			id: true, name: true, username: true, avatar: true,
			role: true, avatarGlowEnabled: true, avatarGlowColors: true,
			profileBanner: true, lastSeen: true,
		},
	},
	reactions: {
		select: { id: true, emoji: true, userId: true, user: { select: { id: true, name: true } } },
	},
	replyTo: {
		select: {
			id: true, content: true, user: { select: { id: true, name: true } },
		},
	},
	reads: {
		select: { userId: true },
	},
	_count: {
		select: { threadReplies: true },
	},
};

// Подтянуть кастомные роли группы (с цветом) для авторов сообщений
async function attachGroupRoles(messages: unknown) {
	const list = Array.isArray(messages) ? messages : [messages];
	if (list.length === 0) return messages;
	const first = list[0] as { channelId?: string };
	if (!first?.channelId) return messages;
	const ch = await prisma.channel.findUnique({ where: { id: first.channelId }, select: { groupId: true } });
	if (!ch) return messages;
	const userIds = [...new Set(list.map((m: { userId?: string }) => m.userId).filter(Boolean))] as string[];
	if (userIds.length === 0) return messages;
	const members = await prisma.groupMember.findMany({
		where: { groupId: ch.groupId, userId: { in: userIds } },
		select: { userId: true, tags: { select: { role: { select: { id: true, name: true, color: true, priority: true } } } } },
	});
	const byUser: Record<string, Array<{ id: string; name: string; color: string; priority: number }>> = {};
	for (const m of members) {
		byUser[m.userId] = m.tags.map((r) => r.role).sort((a, b) => b.priority - a.priority);
	}
	for (const msg of list) {
		const mm = msg as { userId?: string; user?: Record<string, unknown> };
		if (mm.user && mm.userId) mm.user.groupRoles = byUser[mm.userId] || [];
	}
	return messages;
}

export async function GET(req: Request) {
	const session = await getServerSession(authOptions);
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { searchParams } = new URL(req.url);
	const channelId = searchParams.get("channelId");
	const cursor = searchParams.get("cursor");
	const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

	if (!channelId) {
		return NextResponse.json({ error: "channelId required" }, { status: 400 });
	}

	const channel = await prisma.channel.findUnique({
		where: { id: channelId },
		select: { groupId: true, group: { select: { paused: true } } },
	});
	if (!channel) {
		return NextResponse.json({ error: "Channel not found" }, { status: 404 });
	}

	const permission = await getChannelPermissions(session.user.id, channelId);
	if (permission?.isPaused && !permission.canBypassPause) {
		return NextResponse.json({ messages: [], nextCursor: null, paused: true });
	}
	if (!permission?.canView) {
		return NextResponse.json({ error: permission?.denialReason ?? "Forbidden" }, { status: 403 });
	}

	const threadId = searchParams.get("threadId");
	if (threadId) {
		const parentMessage = await prisma.message.findFirst({
			where: { id: threadId, channelId, threadId: null },
			select: { id: true },
		});
		if (!parentMessage) {
			return NextResponse.json({ error: "Thread not found" }, { status: 404 });
		}
	}

	/* Предел глубины истории отозван: историю видят все и целиком. Обычный
	   аккаунт раньше видел последние 30 дней, и со стороны человека это
	   выглядело не как ограничение тарифа, а как потеря переписки. */

	const messages = await prisma.message.findMany({
		where: threadId
			? { channelId, threadId }
			: { channelId, threadId: null },
		include: MESSAGE_SELECT,
		orderBy: { createdAt: "desc" },
		take: limit + 1,
		...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
	});

	const hasMore = messages.length > limit;
	if (hasMore) messages.pop();

	// Update lastRead for this user/channel
	await prisma.channelMember.upsert({
		where: { userId_channelId: { userId: session.user.id, channelId } },
		update: { lastRead: new Date() },
		create: { userId: session.user.id, channelId, lastRead: new Date() },
	});

	// Багфикс: при открытии канала сразу помечаем прочитанными
	// связанные с ним уведомления и сообщаем всем вкладкам/устройствам
	// пользователя, что канал прочитан — бейджи гаснут мгновенно.
	await prisma.notification.updateMany({
		where: {
			userId: session.user.id,
			read: false,
			// Багфикс: contains по одному лишь префиксу ID мог пометить прочитанными
			// уведомления другого канала, чей ID начинается с этого же префикса.
			// По предмету (entityType/entityId) — точное совпадение; ветка по ссылке
			// осталась для записей, созданных до появления предмета у уведомлений.
			OR: [
				{ entityType: "channel", entityId: channelId },
				{ link: { contains: `channel=${channelId}&` } },
				{ link: { endsWith: `channel=${channelId}` } },
			],
		},
		data: { read: true },
	});
	emitToUser(session.user.id, "channel-read", { channelId });

	const ordered = messages.reverse();
	await attachGroupRoles(ordered);
	return NextResponse.json({
		messages: ordered,
		nextCursor: hasMore ? messages[0]?.id : null,
	});
}

export async function POST(req: NextRequest) {
	const limited = await rateLimit(req, "messages", { limit: 30, windowMs: 60 * 1000 });
	if (limited) return limited;

	const session = await getServerSession(authOptions);
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const banned = await checkBan(session.user.id);
	if (banned) return banned;

	const { content, channelId, attachments, replyToId, mentions, threadId } = await req.json();
	if ((!content || !content.trim()) && !attachments) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	if (!channelId) {
		return NextResponse.json({ error: "channelId required" }, { status: 400 });
	}

	/* Предел один и тот же на клиенте и здесь (lib/messageLimits): и в словах,
	   и в знаках. Без подписки он вдвое меньше.

	   Тариф спрашиваем у базы только если текст не влез в бесплатный предел:
	   обычное сообщение — пара строк, и лишний запрос на каждое отправление
	   ради проверки, которая почти никогда не срабатывает, того не стоит. */
	if (content && messageLengthError(content)) {
		const author = await prisma.user.findUnique({
			where: { id: session.user.id },
			select: { isPremium: true, role: true },
		});
		const lengthError = messageLengthError(content, { premium: hasPremium(author) });
		if (lengthError) {
			return NextResponse.json({ error: lengthError }, { status: 400 });
		}
	}

	const channel = await prisma.channel.findUnique({
		where: { id: channelId },
		select: { groupId: true, type: true, isRestricted: true, slowmode: true, postAccess: true, group: { select: { paused: true } } },
	});
	if (!channel) {
		return NextResponse.json({ error: "Channel not found" }, { status: 404 });
	}
	const membership = await prisma.groupMember.findUnique({
		where: { userId_groupId: { userId: session.user.id, groupId: channel.groupId } },
	});
	if (!membership) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const permission = await getChannelPermissions(session.user.id, channelId);
	if (!permission?.canPost) {
		return NextResponse.json({ error: permission?.denialReason ?? "Forbidden" }, { status: 403 });
	}

	const isPrivileged = membership.role === "OWNER" || membership.role === "ADMIN" || membership.role === "MODERATOR";

	// NEW: группа на паузе — писать могут только владелец и администратор.
	if (channel.group?.paused && membership.role !== "OWNER" && membership.role !== "ADMIN") {
		return NextResponse.json({ error: "Группа приостановлена администрацией" }, { status: 403 });
	}

	// NEW: тайм-аут — временное ограничение на отправку сообщений (вкладка «Участники» → Тайм-аут)
	if (!isPrivileged) {
		const timeout = await getActiveTimeout(session.user.id, channelId);
		if (timeout) {
			const until = new Date(timeout.mutedUntil).toLocaleString("ru-RU", {
				day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
			});
			return NextResponse.json(
				{
					error: `Вы временно ограничены в отправке сообщений (до ${until})${timeout.muteReason ? ` — ${timeout.muteReason}` : ""}`,
					mutedUntil: timeout.mutedUntil,
				},
				{ status: 403 },
			);
		}
	}

	// Slowmode check
	if (channel.slowmode > 0 && !isPrivileged) {
		const lastMsg = await prisma.message.findFirst({
			where: { channelId, userId: session.user.id },
			orderBy: { createdAt: "desc" },
			select: { createdAt: true },
		});
		if (lastMsg) {
			const elapsed = (Date.now() - new Date(lastMsg.createdAt).getTime()) / 1000;
			if (elapsed < channel.slowmode) {
				const wait = Math.ceil(channel.slowmode - elapsed);
				return NextResponse.json({ error: `Слоумод: подождите ${wait} сек.` }, { status: 429 });
			}
		}
	}

	// NEWS channels: only OWNER/ADMIN/MODERATOR can post
	if (channel.type === "NEWS" && !isPrivileged) {
		return NextResponse.json({ error: "Only admins can post in news channels" }, { status: 403 });
	}

	// Block-level write access: ADMIN (owner/admin only) or MOD (owner/admin/moderator)
	const isOwnerAdmin = membership.role === "OWNER" || membership.role === "ADMIN";
	if (channel.postAccess === "ADMIN" && !isOwnerAdmin) {
		return NextResponse.json({ error: "Писать в этот раздел может только администратор" }, { status: 403 });
	}
	if (channel.postAccess === "MOD" && !isPrivileged) {
		return NextResponse.json({ error: "Писать в этот раздел могут только администраторы и модераторы" }, { status: 403 });
	}

	const sanitizedContent = content ? sanitizeText(content) : "";
	if (!sanitizedContent && !attachments) {
		return NextResponse.json({ error: "Message content cannot be empty" }, { status: 400 });
	}
	if (replyToId) {
		const reply = await prisma.message.findUnique({ where: { id: replyToId }, select: { channelId: true } });
		if (!reply || reply.channelId !== channelId) return NextResponse.json({ error: "Некорректное сообщение для ответа" }, { status: 400 });
	}
	if (threadId) {
		const parent = await prisma.message.findUnique({ where: { id: threadId }, select: { channelId: true, threadId: true } });
		if (!parent || parent.channelId !== channelId || parent.threadId) return NextResponse.json({ error: "Некорректная ветка обсуждения" }, { status: 400 });
	}
	if (attachments != null) {
		if (!Array.isArray(attachments) || attachments.length > 10 || attachments.some((item: unknown) => {
			if (!item || typeof item !== "object") return true;
			const url = (item as { url?: unknown }).url;
			return typeof url !== "string" || (!url.startsWith("/uploads/") && !url.startsWith("geo:"));
		})) return NextResponse.json({ error: "Некорректные вложения" }, { status: 400 });
	}

	/* CENSOR: словарь сообщества. Проверяем ПОСЛЕ всех прав и ДО создания
	   сообщения: запрет должен отказать в отправке, а не удалять отправленное.
	   Привилегированных не проверяем — правило устанавливают они же, и
	   администратор, споткнувшийся о собственный словарь, выглядит нелепо. */
	const censor = isPrivileged
		? { matches: [], level: null, blocked: false }
		: await checkCensor(channel.groupId, sanitizedContent);
	if (censor.blocked) {
		/* Какое именно слово не понравилось — не называем: это подсказка, как
		   обойти фильтр. Человеку достаточно знать, что текст не проходит. */
		await recordCensorHits({
			groupId: channel.groupId,
			userId: session.user.id,
			channelId,
			matches: censor.matches,
		});
		return NextResponse.json(
			{ error: "Сообщение не отправлено: в тексте есть слова, запрещённые в этом сообществе", censored: true },
			{ status: 422 },
		);
	}

	const message = await prisma.message.create({
		data: {
			content: sanitizedContent,
			channelId,
			userId: session.user.id,
			attachments: attachments ? JSON.stringify(attachments) : null,
			replyToId: replyToId || null,
			threadId: threadId || null,
			mentions: mentions ? JSON.stringify(mentions) : null,
		},
		include: MESSAGE_SELECT,
	});

	// Update thread parent counter
	if (threadId) {
		await prisma.message.update({
			where: { id: threadId },
			data: { threadCount: { increment: 1 } },
		});
	}

	/* Наблюдения пишем уже после создания: иначе счётчик рос бы и от сообщений,
	   которые не отправились по другой причине. */
	if (censor.matches.length > 0) {
		await recordCensorHits({
			groupId: channel.groupId,
			userId: session.user.id,
			channelId,
			matches: censor.matches,
		});
	}

	await attachGroupRoles(message);
	emitToChannel(channelId, "new-message", message);

	// Resolve mention recipients server-side: only group members, never the global user base.
	// @everyone notifies every member of the group.
	const isEveryone = /@everyone\b/.test(sanitizedContent);
	let mentionRecipients: string[] = [];
	if (isEveryone) {
		const allMembers = await prisma.groupMember.findMany({
			where: { groupId: channel.groupId },
			select: { userId: true },
		});
		mentionRecipients = allMembers.map((m) => m.userId);
	} else if (mentions && Array.isArray(mentions) && mentions.length > 0) {
		const validMembers = await prisma.groupMember.findMany({
			where: { groupId: channel.groupId, userId: { in: mentions.filter((m: unknown) => typeof m === "string") } },
			select: { userId: true },
		});
		mentionRecipients = validMembers.map((m) => m.userId);
	}

	// FIX-TAGMENTION: упоминание тега сообщества («#тестер») уведомляет всех
	// носителей этого тега. Решётка исторически означает ещё и переход в канал,
	// поэтому токен считается тегом только при точном совпадении с именем роли
	// этой группы — иначе поведение прежнее (ссылка на канал, без уведомлений).
	const notifyTitles = new Map<string, string>();
	for (const userId of mentionRecipients) notifyTitles.set(userId, "");
	const tagTokens = new Set(
		Array.from(sanitizedContent.matchAll(/(?:^|[\s([{>])#([A-Za-z0-9_а-яА-ЯёЁ-]+)/g), (m) => m[1].toLowerCase()),
	);
	if (tagTokens.size > 0) {
		const groupRoles = await prisma.groupRole.findMany({
			where: { groupId: channel.groupId },
			select: { id: true, name: true },
		});
		const matched = groupRoles.filter((r) => tagTokens.has(r.name.toLowerCase()));
		if (matched.length > 0) {
			const nameById = new Map<string, string>(matched.map((r) => [r.id, r.name] as [string, string]));
			const holders = await prisma.groupMemberRole.findMany({
				where: { roleId: { in: matched.map((r) => r.id) }, member: { groupId: channel.groupId } },
				select: { roleId: true, member: { select: { userId: true } } },
				take: 1000,
			});
			for (const h of holders) {
				// Прямое @упоминание важнее: у него остаётся свой заголовок.
				if (notifyTitles.has(h.member.userId)) continue;
				notifyTitles.set(h.member.userId, `#${nameById.get(h.roleId) ?? ""}`);
			}
		}
	}

	if (notifyTitles.size > 0) {
		const senderName = message.user?.name || "Пользователь";
		const notificationLink = `/connect?group=${channel.groupId}&channel=${channelId}&message=${message.id}`;
		const notificationBody = sanitizedContent.slice(0, 100);

		if (isEveryone) {
			// @everyone: настройки заглушки и вставка уведомлений пакетом —
			// цикл давал по два запроса на каждого участника группы.
			const recipients = Array.from(notifyTitles.keys()).filter((id) => id !== session.user.id);

			// Заглушенные каналы одним запросом вместо findUnique на каждого
			const mutedChannels = await prisma.channelMute.findMany({
				where: { channelId, userId: { in: recipients } },
				select: { userId: true, muted: true },
			});
			const mutedChannelSet = new Set(
				mutedChannels.filter((cm) => cm.muted === true).map((cm) => cm.userId),
			);
			// Явный unmute на канале отменяет заглушку группы
			const explicitUnmuteSet = new Set(
				mutedChannels.filter((cm) => cm.muted === false).map((cm) => cm.userId),
			);

			// Заглушенные группы одним запросом
			const mutedGroups = await prisma.groupMember.findMany({
				where: { groupId: channel.groupId, userId: { in: recipients }, muted: true },
				select: { userId: true },
			});
			const mutedGroupSet = new Set(mutedGroups.map((gm) => gm.userId));

			// Фильтруем: убираем заглушенных и тех, кто смотрит канал прямо сейчас
			const viewingChecks = await Promise.all(
				recipients.map(async (id) => ({ id, viewing: await isUserViewingChannel(id, channelId) })),
			);
			const finalRecipients = viewingChecks
				.filter(({ id, viewing }) => {
					if (viewing) return false;
					if (mutedChannelSet.has(id)) return false;
					if (mutedGroupSet.has(id) && !explicitUnmuteSet.has(id)) return false;
					return true;
				})
				.map(({ id }) => id);

			if (finalRecipients.length > 0) {
				createNotificationsBulk({
					userIds: finalRecipients,
					type: "mention",
					title: `${senderName} упомянул всех`,
					body: notificationBody,
					link: notificationLink,
					// Предмет — канал: несколько упоминаний подряд группируются в
					// одно уведомление, и открытие канала гасит их разом.
					entityType: "channel",
					entityId: channelId,
				}).catch(() => {});
			}
		} else {
			// Адресные упоминания (@user или #тег): у каждого получателя может быть
			// свой заголовок, поэтому цикл остаётся — пакетная вставка здесь не применима.
			for (const [mentionedId, viaTag] of notifyTitles) {
				if (mentionedId !== session.user.id) {
					// Check mute settings
					let isMuted = false;
					if (channel?.groupId) {
						const [gm, cm] = await Promise.all([
							prisma.groupMember.findUnique({ where: { userId_groupId: { userId: mentionedId, groupId: channel.groupId } }, select: { muted: true } }),
							prisma.channelMute.findUnique({ where: { userId_channelId: { userId: mentionedId, channelId } }, select: { muted: true } }),
						]);
						isMuted = cm?.muted === true || (gm?.muted === true && cm?.muted !== false);
					}
					if (!isMuted) {
						// Багфикс: не создавать уведомление, если получатель
						// прямо сейчас смотрит этот канал — он и так видит сообщение.
						const viewing = await isUserViewingChannel(mentionedId, channelId);
						if (!viewing) {
							createNotification({
								userId: mentionedId,
								type: "mention",
								title: viaTag ? `${senderName} упомянул тег ${viaTag}` : `${senderName} упомянул вас`,
								body: notificationBody,
								link: notificationLink,
								// Предмет — канал: повторные упоминания одного человека
								// в этом канале схлопываются в одно уведомление.
								entityType: "channel",
								entityId: channelId,
							}).catch(() => {});
						}
					}
				}
			}
		}
	}

	/* Предупреждение отдаём вместе с созданным сообщением: карточку про рамки
	   приличия показывает клиент, и знать о ней должен только отправитель —
	   остальным участникам это сообщение приходит обычным. */
	if (censor.level === "WARN") {
		return NextResponse.json({ ...message, censorWarning: true });
	}
	return NextResponse.json(message);
}

export async function PATCH(req: NextRequest) {
	const session = await getServerSession(authOptions);
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const banned = await checkBan(session.user.id);
	if (banned) return banned;

	const { messageId, content } = await req.json();
	if (!messageId || !content?.trim()) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	if (messageLengthError(content)) {
		const author = await prisma.user.findUnique({
			where: { id: session.user.id },
			select: { isPremium: true, role: true },
		});
		const editLengthError = messageLengthError(content, { premium: hasPremium(author) });
		if (editLengthError) {
			return NextResponse.json({ error: editLengthError }, { status: 400 });
		}
	}

	const existing = await prisma.message.findUnique({ where: { id: messageId } });
	if (!existing) {
		return NextResponse.json({ error: "Message not found" }, { status: 404 });
	}
	if (existing.userId !== session.user.id) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	if (existing.deleted) {
		return NextResponse.json({ error: "Cannot edit deleted message" }, { status: 400 });
	}

	const sanitizedContent = sanitizeText(content);
	const message = await prisma.message.update({
		where: { id: messageId },
		data: {
			content: sanitizedContent,
			edited: true,
			editedAt: new Date(),
		},
		include: MESSAGE_SELECT,
	});

	await attachGroupRoles(message);
	emitToChannel(existing.channelId, "message-edited", message);

	return NextResponse.json(message);
}

export async function DELETE(req: NextRequest) {
	const session = await getServerSession(authOptions);
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { searchParams } = new URL(req.url);
	const messageId = searchParams.get("messageId");
	if (!messageId) {
		return NextResponse.json({ error: "messageId required" }, { status: 400 });
	}

	const existing = await prisma.message.findUnique({
		where: { id: messageId },
		include: {
			user: { select: { id: true, name: true, username: true } },
			channel: { select: { id: true, name: true, groupId: true } },
		},
	});
	if (!existing) {
		return NextResponse.json({ error: "Message not found" }, { status: 404 });
	}

	const isAuthor = existing.userId === session.user.id;

	/* MODERATION: раньше здесь стояла одна проверка — автор либо `user.role
	   === "ADMIN"`. Это сайтовая роль, а не групповая, поэтому владелец группы
	   не мог удалить чужое сообщение у себя же, а администратор платформы мог
	   удалить любое в любой группе. Из-за этого пункта «удалить сообщение» не
	   было и в контекстном меню: его нечем было обслужить.

	   Теперь три пути: автор, модерация группы строго выше автора по рангу и
	   администратор платформы. Последний оставлен намеренно — на нём держится
	   разбор жалоб вне групп. */
	const siteRole = (await prisma.user.findUnique({
		where: { id: session.user.id },
		select: { role: true },
	}))?.role;
	const isSiteAdmin = siteRole === "ADMIN";

	let asModerator = false;
	const groupId = existing.channel?.groupId ?? null;

	if (!isAuthor && !isSiteAdmin && groupId) {
		const [mine, theirs] = await Promise.all([
			prisma.groupMember.findUnique({
				where: { userId_groupId: { userId: session.user.id, groupId } },
				select: { role: true },
			}),
			prisma.groupMember.findUnique({
				where: { userId_groupId: { userId: existing.userId, groupId } },
				select: { role: true },
			}),
		]);
		if (rankOf(mine?.role) >= RANK_MODERATOR && canActOn(mine?.role, theirs?.role ?? null)) {
			asModerator = true;
		}
	}

	if (!isAuthor && !isSiteAdmin && !asModerator) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// Hard delete — permanently remove from DB, no trace left
	await prisma.message.delete({ where: { id: messageId } });

	/* Чужое сообщение удаляется только со следом в журнале. Иначе «удалить и
	   забанить» стало бы способом бесследно подчистить историю — а журнал
	   группы для того и заведён. Своё сообщение автор удаляет молча: это не
	   мера воздействия. */
	if (asModerator && groupId) {
		const excerpt = (existing.content ?? "").trim().slice(0, 200);
		await logGroupAction({
			groupId,
			actorId: session.user.id,
			actorName: session.user.username || session.user.name || "user",
			action: "message.delete",
			targetId: existing.user.id,
			targetName: existing.user.username || existing.user.name,
			details: `Канал #${existing.channel?.name ?? "?"}${excerpt ? `: «${excerpt}»` : ""}`,
		});
	}

	emitToChannel(existing.channelId, "message-deleted", { id: messageId, channelId: existing.channelId });

	return NextResponse.json({ ok: true, id: messageId });
}
