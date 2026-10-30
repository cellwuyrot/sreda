import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { sanitizeText } from "@/lib/sanitize";
import { SOCKET_EVENTS } from "@trioz/shared";
import { emitToUser } from "@/lib/socketEmit";
import { createNotification } from "@/lib/createNotification";
import { messageLengthError } from "@/lib/messageLimits";
import { hasPremium } from "@/lib/premium";
import { businessAudience, isStaffRole, staffIds } from "@/lib/businessChat";
import { validReplyQuote } from "@/lib/replyQuote";
import { dmPageLimit, secureDmError } from "@/lib/dmPolicy";
import { rateLimit } from "@/lib/rateLimit";

/**
 * Кто может открыть эту переписку.
 *
 * Личная — только двое участников. Деловая (по обращению) — ещё и вся
 * администрация: очередь заявок общая, и разговор не должен становиться
 * недоступным из-за того, что отвечавший в отпуске. Право даёт роль, а не место
 * в паре, — на этом и держится связка «клиенту один чат, администрации общий».
 *
 * Проверка живёт здесь, а не в lib/connectPermissions, потому что дальше по
 * обработчику нужна сама запись разговора: вид, назначенный ведущий, участники.
 */
async function openConversation(id: string, viewer: { id: string; role?: string | null }) {
  const conversation = await prisma.directConversation.findUnique({ where: { id } });
  if (!conversation) return { conversation: null, allowed: false, participant: false };
  const participant = conversation.user1Id === viewer.id || conversation.user2Id === viewer.id;
  const business = conversation.kind === "BUSINESS";
  return {
    conversation,
    participant,
    allowed: participant || (business && isStaffRole(viewer.role)),
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;

  const { conversation, allowed } = await openConversation(id, session.user);
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  // Thread UI is intentionally disabled until a separate thread model is implemented.
  if (searchParams.has("threadId")) return NextResponse.json({ error: "Ветки пока не поддерживаются" }, { status: 400 });
  const limit = dmPageLimit(searchParams.get("limit"));
  const cursor = searchParams.get("cursor");
  const after = searchParams.get("after");
  const around = searchParams.get("around");
  if ([cursor, after, around].filter(Boolean).length > 1) return NextResponse.json({ error: "Неоднозначная навигация" }, { status: 400 });
  const targetId = cursor || after || around;
  const target = targetId ? await prisma.directMessage.findFirst({ where: { id: targetId, conversationId: id } }) : null;
  if (targetId && !target) return NextResponse.json({ error: "Сообщение не найдено" }, { status: 404 });
  const include = {
    user: { select: { id: true, name: true, username: true, avatar: true, role: true, avatarGlowEnabled: true, avatarGlowColors: true } },
    replyTo: { select: { id: true, content: true, deleted: true, user: { select: { id: true, name: true } } } },
    reactions: { include: { user: { select: { id: true, name: true, username: true } } } },
  };
  const where: Prisma.DirectMessageWhereInput = { conversationId: id };
  const encryptedParam = searchParams.get("encrypted");
  if (encryptedParam === "true" || encryptedParam === "false") where.encrypted = encryptedParam === "true";
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  let messages;
  let hasMore = false, hasNewer = false;
  if (around && target) {
    const [older, newer] = await Promise.all([
      prisma.directMessage.findMany({ where, include, orderBy, cursor: { id: target.id }, skip: 1, take: limit + 1 }),
      prisma.directMessage.findMany({ where, include, orderBy: [{ createdAt: "asc" }, { id: "asc" }], cursor: { id: target.id }, take: limit + 1 }),
    ]);
    hasMore = older.length > limit; hasNewer = newer.length > limit;
    messages = [...older.slice(0, limit).reverse(), ...newer.slice(0, limit)];
  } else {
    const rows = await prisma.directMessage.findMany({ where, include,
      orderBy: after ? [{ createdAt: "asc" }, { id: "asc" }] : orderBy,
      take: limit + 1, ...(target ? { cursor: { id: target.id }, skip: 1 } : {}),
    });
    const more = rows.length > limit;
    messages = after ? rows.slice(0, limit) : rows.slice(0, limit).reverse();
    hasMore = after ? false : more; hasNewer = after ? more : false;
  }
  // Redacted deletion must not leave stale quoted plaintext in a reply.
  messages = messages.map(m => ({ ...m, ...(m.deleted ? { content: "", attachments: null, reactions: [], replyQuote: null } : {}), replyTo: m.replyTo?.deleted ? { ...m.replyTo, content: "Сообщение удалено" } : m.replyTo }));
  const readAt = conversation.user1Id === userId ? conversation.user1ReadAt : conversation.user2ReadAt;
  const firstUnread = await prisma.directMessage.findFirst({ where: { conversationId: id, deleted: false, userId: { not: userId }, ...(readAt ? { createdAt: { gt: readAt } } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  return NextResponse.json({ firstUnreadId: firstUnread?.id || null, messages, nextCursor: hasMore ? messages[0]?.id : null,
    afterCursor: hasNewer ? messages[messages.length - 1]?.id : null,
    readAt: conversation.user1Id === userId ? conversation.user1ReadAt : conversation.user2ReadAt,
    peerReadAt: conversation.user1Id === userId ? conversation.user2ReceiptAt : conversation.user1ReceiptAt,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(req, "dm-messages", { limit: 30, windowMs: 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const userId = session.user.id;

  const { conversation, allowed } = await openConversation(id, session.user);
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const isBusiness = conversation.kind === "BUSINESS";

  /* BUSINESS-LOCK: администрация закрыла клиенту отправку в этом разговоре.
     Запрет односторонний — администрация отвечать может. Иначе последнее слово
     всегда оставалось бы за клиентом, а именно от этого закрытие и нужно:
     игнорировать его в деловом разговоре нельзя, чёрного списка здесь нет и быть
     не может (сторона — администрация, а не человек). */
  if (isBusiness && conversation.locked && !isStaffRole(session.user.role)) {
    return NextResponse.json(
      { error: "Администрация закрыла отправку сообщений по этому обращению", locked: true },
      { status: 403 },
    );
  }

  // FIX-DM: персональные настройки ЛС. peerSetting — настройки собеседника
  // по отношению к отправителю, mySetting — наоборот. Чёрный список
  // блокирует переписку в обе стороны.
  //
  // В деловом разговоре этих настроек нет вовсе: собеседник там не человек, а
  // администрация, и чёрный список между клиентом и случайно попавшим в пару
  // сотрудником не должен глушить рабочую переписку по заявке.
  const peerId = conversation.user1Id === userId ? conversation.user2Id : conversation.user1Id;
  let peerSetting: { blacklisted: boolean; voiceBan: boolean; autoReplyEnabled: boolean; autoReplyText: string | null; lastAutoReplyAt: Date | null } | null = null;
  let mySetting: { blacklisted: boolean } | null = null;
  if (!isBusiness && peerId !== userId) {
    try {
      [peerSetting, mySetting] = await Promise.all([
        prisma.dmUserSetting.findUnique({ where: { ownerId_targetId: { ownerId: peerId, targetId: userId } } }),
        prisma.dmUserSetting.findUnique({ where: { ownerId_targetId: { ownerId: userId, targetId: peerId } } }),
      ]);
    } catch { /* таблица настроек ещё не создана — работаем без ограничений */ }
  }
  if (peerSetting?.blacklisted) {
    return NextResponse.json({ error: "Пользователь ограничил личные сообщения" }, { status: 403 });
  }
  if (mySetting?.blacklisted) {
    return NextResponse.json({ error: "Собеседник у вас в чёрном списке — сначала уберите его из ЧС" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  const { content = "", attachments, replyToId, replyQuote, clientMessageId, threadId, previewSuppressed } = body;
  if (previewSuppressed !== undefined && typeof previewSuppressed !== "boolean") return NextResponse.json({ error: "Invalid preview preference" }, { status: 400 });
  if (typeof content !== "string" || (replyToId != null && typeof replyToId !== "string") ||
      (replyQuote != null && (typeof replyQuote !== "string" || replyQuote.length > 2000 || !replyToId)) ||
      (clientMessageId != null && (typeof clientMessageId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(clientMessageId))) || threadId != null) {
    return NextResponse.json({ error: "Некорректные поля сообщения" }, { status: 400 });
  }
  const secureError = secureDmError(conversation.kind, content, attachments, replyQuote);
  if (secureError) return NextResponse.json({ error: secureError }, { status: 400 });
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (attachments != null && (!Array.isArray(attachments) || attachments.length > 10 || attachments.some((item: unknown) => {
    if (!item || typeof item !== "object") return true;
    const url = (item as { url?: unknown }).url;
    return typeof url !== "string" || (!url.startsWith("/uploads/") && !url.startsWith("geo:"));
  }))) return NextResponse.json({ error: "Некорректные вложения" }, { status: 400 });
  /* FIX-DM: запрет голосовых сообщений от этого отправителя.
     Видеосообщение («квадрат» с камеры) считается тем же самым: человек
     запрещал не формат файла, а необходимость слушать чужой голос вместо
     чтения. Иначе запрет обходится сменой кнопки в том же вводе. */
  if (peerSetting?.voiceBan && Array.isArray(attachments) &&
      attachments.some((a: unknown) => {
        if (!a || typeof a !== "object") return false;
        const item = a as { isVoice?: unknown; isVideoNote?: unknown };
        return item.isVoice === true || item.isVideoNote === true;
      })) {
    return NextResponse.json({ error: "Пользователь запретил голосовые и видеосообщения" }, { status: 403 });
  }
  if (replyToId) {
    const reply = await prisma.directMessage.findUnique({ where: { id: replyToId }, select: { conversationId: true, deleted: true, content: true } });
    if (!reply || reply.deleted || reply.conversationId !== id) return NextResponse.json({ error: "Некорректное сообщение для ответа" }, { status: 400 });
    if (replyQuote != null && !validReplyQuote(replyQuote, reply.content)) return NextResponse.json({ error: "Цитата не соответствует исходному сообщению" }, { status: 400 });
  }
  if ((!content || !content.trim()) && !hasAttachments) {
    return NextResponse.json({ error: "Message content required" }, { status: 400 });
  }
  /* Предел общий с клиентом (lib/messageLimits). Шифротекст длиннее исходного
     примерно наполовину, и слов в нём нет — для него отдельный порог по знакам.
     Без подписки предел вдвое меньше; тариф спрашиваем у базы, только если
     текст не влез в бесплатный — на каждое сообщение лишний запрос не нужен. */
  const encrypted = !!content && content.startsWith("e2ee:");
  if (content && messageLengthError(content, { encrypted })) {
    const author = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isPremium: true, role: true },
    });
    const lengthError = messageLengthError(content, { encrypted, premium: hasPremium(author) });
    if (lengthError) {
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }
  }

  const isE2EE = content && content.startsWith("e2ee:");
  const sanitized = isE2EE ? content : (content ? sanitizeText(content) : "");
  if (!sanitized && !hasAttachments) {
    return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
  }

  const baseData = {
    content: sanitized,
    conversationId: id,
    userId,
    attachments: hasAttachments ? JSON.stringify(attachments) : null,
    replyToId: replyToId || null,
    replyQuote: replyQuote ? sanitizeText(replyQuote) : null,
    clientMessageId: clientMessageId || null,
  };
  const include = {
    user: { select: { id: true, name: true, username: true, avatar: true, role: true, avatarGlowEnabled: true, avatarGlowColors: true } },
    replyTo: { select: { id: true, content: true, user: { select: { id: true, name: true } } } },
  };

  const existing = clientMessageId ? await prisma.directMessage.findUnique({
    where: { conversationId_userId_clientMessageId: { conversationId: id, userId, clientMessageId } }, include,
  }) : null;
  if (existing) return NextResponse.json(existing);

  type DmWithIncludes = Prisma.DirectMessageGetPayload<{ include: typeof include }>;

  let message: DmWithIncludes;
  try {
    // FIX-SEC: флаг encrypted определяется ТОЛЬКО сервером по префиксу e2ee:,
    // а не по клиентскому полю (раньше любой truthy `encrypted` из тела запроса
    // подменял классификацию сообщения).
    message = await prisma.directMessage.create({
      data: { ...baseData, encrypted: !!isE2EE, previewSuppressed: !!isE2EE || previewSuppressed === true },
      include,
    });
  } catch (err: unknown) {
    // Concurrent retries return the already-created message; no duplicate notifications.
    if (clientMessageId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.directMessage.findUnique({ where: { conversationId_userId_clientMessageId: { conversationId: id, userId, clientMessageId } }, include });
      if (existing) return NextResponse.json(existing);
    }
    throw err;
  }

  await prisma.directConversation.update({
    where: { id },
    data: { lastMessageAt: new Date() },
  });

  /* ── Деловой разговор: адресатов больше двух ──────────────────────────────
     Событие уходит клиенту и всей администрации: очередь общая, и новое
     сообщение должно поднимать разговор в списке у каждого, а не только у того,
     кто уже открыл чат.

     Здесь же работает связка: если из администрации в чат написал первый
     человек, а заявку ещё не брали — он её и взял. Иначе двое отвечают одному
     клиенту, не зная друг о друге. */
  if (isBusiness) {
    const clientId = conversation.user1Id;
    let handlerId = conversation.handlerId;
    if (!handlerId && userId !== clientId && isStaffRole(session.user.role)) {
      handlerId = userId;
      await prisma.directConversation.update({ where: { id }, data: { handlerId } });
    }

    const audience = await businessAudience(conversation);
    const prefs = await prisma.user.findMany({
      where: { id: { in: audience } },
      select: { id: true, notifyPush: true },
    });
    const pushOff = new Set(
      prefs
        .filter((person: { notifyPush: boolean }) => person.notifyPush === false)
        .map((person: { id: string }) => person.id),
    );
    for (const recipientId of audience) {
      emitToUser(recipientId, SOCKET_EVENTS.DM_MESSAGE, {
        ...message,
        conversationId: id,
        pushEnabled: !pushOff.has(recipientId),
      });
    }

    /* Уведомление — противоположной стороне. Клиенту пишет тот, кто ведёт; если
       написал клиент, узнаёт ведущий, а пока заявку не взяли — вся
       администрация, иначе сообщение не увидит никто. */
    const targets =
      userId === clientId
        ? handlerId
          ? [handlerId]
          : await staffIds(userId)
        : [clientId];
    for (const target of targets) {
      createNotification({
        userId: target,
        type: "appeal",
        title:
          userId === clientId
            ? `Сообщение по обращению от ${message.user.name}`
            : "Ответ администрации по вашему обращению",
        body: (content || "").slice(0, 100),
        link: "/connect?section=business",
        /* Из-за кого и о чём: разговор прочитали — уведомление погасло, автора
           удалили — уведомление ушло вместе с ним (см. lib/createNotification). */
        actorId: userId,
        entityType: "dm",
        entityId: id,
      }).catch(() => {});
    }

    return NextResponse.json(message);
  }

  const otherId = conversation.user1Id === userId ? conversation.user2Id : conversation.user1Id;
  // Настройка push-уведомлений получателя: десктопная оболочка по флагу
  // pushEnabled решает, показывать ли нативный тост (сам чат обновляется всегда).
  const recipient = await prisma.user.findUnique({
    where: { id: otherId },
    select: { notifyPush: true },
  });
  const dmPayload = { ...message, conversationId: id, pushEnabled: recipient?.notifyPush !== false };
  emitToUser(otherId, SOCKET_EVENTS.DM_MESSAGE, dmPayload);
  emitToUser(userId, SOCKET_EVENTS.DM_MESSAGE, dmPayload);

  // FIX-DM: автоответ собеседника — не чаще раза в час, никогда не ломает отправку сообщения.
  try {
    const autoText = conversation.kind !== "SECURE" && peerSetting?.autoReplyEnabled ? peerSetting.autoReplyText?.trim() : null;
    if (autoText && peerId !== userId) {
      const last = peerSetting?.lastAutoReplyAt?.getTime() ?? 0;
      if (Date.now() - last > 60 * 60 * 1000) {
        const claimed = await prisma.dmUserSetting.updateMany({
          where: {
            ownerId: peerId,
            targetId: userId,
            OR: [
              { lastAutoReplyAt: null },
              { lastAutoReplyAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
            ],
          },
          data: { lastAutoReplyAt: new Date() },
        });
        if (claimed.count === 1) {
          const auto = await prisma.directMessage.create({
            data: { content: `🤖 Автоответ: ${autoText}`, conversationId: id, userId: peerId },
            include,
          });
          await prisma.directConversation.update({ where: { id }, data: { lastMessageAt: new Date() } });
          const autoPayload = { ...auto, conversationId: id, pushEnabled: false };
          emitToUser(userId, SOCKET_EVENTS.DM_MESSAGE, autoPayload);
          emitToUser(peerId, SOCKET_EVENTS.DM_MESSAGE, autoPayload);
        }
      }
    }
  } catch { /* автоответ необязателен */ }

  createNotification({
    userId: otherId,
    type: "dm",
    title: `Новое сообщение от ${message.user.name}`,
    body: content?.startsWith("e2ee:") ? "Зашифрованное сообщение" : (content || "").slice(0, 100),
    link: `/connect?section=dm&dm=${userId}&message=${message.id}`,
    actorId: userId,
    entityType: "dm",
    entityId: id,
  }).catch(() => {});

  return NextResponse.json(message);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const access = await openConversation(id, session.user);
  if (!access.conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (access.conversation.kind === "BUSINESS" && access.conversation.locked && !isStaffRole(session.user.role)) {
    return NextResponse.json({ error: "Администрация закрыла отправку сообщений по этому обращению", locked: true }, { status: 403 });
  }
  const { messageId, content } = await req.json().catch(() => ({}));
  if (typeof messageId !== "string" || typeof content !== "string" || !content.trim()) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const secureError = secureDmError(access.conversation.kind, content);
  if (secureError) return NextResponse.json({ error: secureError }, { status: 400 });

  // FIX-SEC-VALIDATION: раньше при редактировании не было лимита длины (в отличие
  // от POST) — можно было раздуть запись в БД. Зеркалим ограничение POST.
  const editEncrypted = content.startsWith("e2ee:");
  if (messageLengthError(content, { encrypted: editEncrypted })) {
    const author = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isPremium: true, role: true },
    });
    const editLengthError = messageLengthError(content, { encrypted: editEncrypted, premium: hasPremium(author) });
    if (editLengthError) return NextResponse.json({ error: editLengthError }, { status: 400 });
  }

  const message = await prisma.directMessage.findUnique({ where: { id: messageId } });
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (message.deleted) return NextResponse.json({ error: "Сообщение удалено" }, { status: 409 });
  if (message.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (message.conversationId !== id) return NextResponse.json({ error: "Mismatch" }, { status: 400 });

  const updated = await prisma.directMessage.update({
    where: { id: messageId },
    data: { content: content.startsWith("e2ee:") ? content : sanitizeText(content), encrypted: content.startsWith("e2ee:"), edited: true, editedAt: new Date() },
    include: {
      user: { select: { id: true, name: true, username: true, avatar: true, role: true, avatarGlowEnabled: true, avatarGlowColors: true } },
    },
  });

  const conversation = await prisma.directConversation.findUnique({ where: { id } });
  if (conversation) {
    const payload = { ...updated, conversationId: id };
    /* В деловом разговоре адресатов больше двух: правку должна увидеть вся
       администрация, иначе у части сотрудников остаётся прежний текст. */
    const audience =
      conversation.kind === "BUSINESS"
        ? await businessAudience(conversation)
        : [conversation.user1Id, conversation.user2Id];
    for (const recipientId of new Set([...audience, session.user.id])) {
      emitToUser(recipientId, "dm-edited", payload);
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const access = await openConversation(id, session.user);
  if (!access.conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (access.conversation.kind === "BUSINESS" && access.conversation.locked && !isStaffRole(session.user.role)) {
    return NextResponse.json({ error: "Администрация закрыла отправку сообщений по этому обращению", locked: true }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const messageId = searchParams.get("messageId");
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const message = await prisma.directMessage.findUnique({ where: { id: messageId } });
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (message.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (message.conversationId !== id) return NextResponse.json({ error: "Mismatch" }, { status: 400 });

  await prisma.directMessage.update({
    where: { id: messageId },
    data: { deleted: true, content: "", attachments: null, replyToId: null },
  });

  const conversation = await prisma.directConversation.findUnique({ where: { id } });
  if (conversation) {
    const payload = { messageId, conversationId: id };
    const audience =
      conversation.kind === "BUSINESS"
        ? await businessAudience(conversation)
        : [conversation.user1Id, conversation.user2Id];
    for (const recipientId of new Set([...audience, session.user.id])) {
      emitToUser(recipientId, "dm-deleted", payload);
    }
  }

  return NextResponse.json({ ok: true });
}
