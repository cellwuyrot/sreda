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
  const cursor = searchParams.get("cursor");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const encryptedParam = searchParams.get("encrypted"); // "true" | "false" | null (all)

  // Build where clause — filter by encrypted flag if column exists
  const encryptedFilter: { encrypted?: boolean } = {};
  if (encryptedParam === "true")  encryptedFilter.encrypted = true;
  if (encryptedParam === "false") encryptedFilter.encrypted = false;

  const messages = await prisma.directMessage.findMany({
    where: { conversationId: id, ...encryptedFilter },
    include: {
      user: { select: { id: true, name: true, username: true, avatar: true, role: true, avatarGlowEnabled: true, avatarGlowColors: true } },
      replyTo: { select: { id: true, content: true, user: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = messages.length > limit;
  if (hasMore) messages.pop();

  return NextResponse.json({
    messages: messages.reverse(),
    nextCursor: hasMore ? messages[0]?.id : null,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { content, attachments, replyToId } = await req.json();
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
    const reply = await prisma.directMessage.findUnique({ where: { id: replyToId }, select: { conversationId: true } });
    if (!reply || reply.conversationId !== id) return NextResponse.json({ error: "Некорректное сообщение для ответа" }, { status: 400 });
  }
  if ((!content || !content.trim()) && !attachments) {
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
  if (!sanitized && !attachments) {
    return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
  }

  const baseData = {
    content: sanitized,
    conversationId: id,
    userId,
    attachments: attachments ? JSON.stringify(attachments) : null,
    replyToId: replyToId || null,
  };
  const include = {
    user: { select: { id: true, name: true, username: true, avatar: true, role: true, avatarGlowEnabled: true, avatarGlowColors: true } },
    replyTo: { select: { id: true, content: true, user: { select: { id: true, name: true } } } },
  };

  type DmWithIncludes = Prisma.DirectMessageGetPayload<{ include: typeof include }>;

  let message: DmWithIncludes;
  try {
    // FIX-SEC: флаг encrypted определяется ТОЛЬКО сервером по префиксу e2ee:,
    // а не по клиентскому полю (раньше любой truthy `encrypted` из тела запроса
    // подменял классификацию сообщения).
    message = await prisma.directMessage.create({
      data: { ...baseData, encrypted: !!isE2EE },
      include,
    });
  } catch (err: unknown) {
    // Fallback: if encrypted column doesn't exist yet (migration pending),
    // create without it so DMs keep working
    const isColErr = err instanceof Error &&
      (err.message.includes("encrypted") || err.message.includes("Unknown field") || err.message.includes("column"));
    if (!isColErr) throw err;
    // Cast to a minimal shape that supports .create() — the encrypted column
    // may be missing if the migration is pending. Avoid `any` for lint safety.
    const fallback = prisma.directMessage as unknown as {
      create: (args: { data: typeof baseData; include: typeof include }) => Promise<DmWithIncludes>;
    };
    message = await fallback.create({ data: baseData, include });
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
    const autoText = peerSetting?.autoReplyEnabled ? peerSetting.autoReplyText?.trim() : null;
    if (autoText && peerId !== userId) {
      const last = peerSetting?.lastAutoReplyAt?.getTime() ?? 0;
      if (Date.now() - last > 60 * 60 * 1000) {
        await prisma.dmUserSetting.update({
          where: { ownerId_targetId: { ownerId: peerId, targetId: userId } },
          data: { lastAutoReplyAt: new Date() },
        });
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

  const { id } = await params;
  const { messageId, content } = await req.json();
  if (!messageId || !content?.trim()) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

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
  if (message.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (message.conversationId !== id) return NextResponse.json({ error: "Mismatch" }, { status: 400 });

  const updated = await prisma.directMessage.update({
    where: { id: messageId },
    data: { content: content.startsWith("e2ee:") ? content : sanitizeText(content), edited: true, editedAt: new Date() },
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

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const messageId = searchParams.get("messageId");
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const message = await prisma.directMessage.findUnique({ where: { id: messageId } });
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (message.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (message.conversationId !== id) return NextResponse.json({ error: "Mismatch" }, { status: 400 });

  await prisma.directMessage.update({
    where: { id: messageId },
    data: { deleted: true, content: "" },
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
