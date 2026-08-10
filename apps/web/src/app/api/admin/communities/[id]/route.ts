import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { SOCKET_EVENTS } from "@trioz/shared";
import { emitToUser } from "@/lib/socketEmit";
import { createNotification } from "@/lib/createNotification";
import { logAction } from "@/lib/audit";

/**
 * ADM-COMM: две меры модерации над сообществом.
 *
 * PATCH — приостановить или возобновить работу.
 * POST  — написать создателю в личные сообщения.
 *
 * ── Почему отдельный маршрут, а не PATCH /api/groups/[id] ───────────────
 *
 * Тот маршрут умеет ставить паузу, но начинается с поиска `groupMember` и
 * требует роли OWNER/ADMIN ВНУТРИ сообщества. Сайтовый администратор в
 * чужом сообществе не состоит — и получил бы 403. Модерация проекта и не
 * должна требовать вступления в сообщество: вступление видно участникам и
 * меняет состав, а мера должна применяться извне.
 *
 * Поле в базе при этом то же самое (`Group.paused`), и последствия тоже:
 * `lib/connectPermissions` скрывает каналы всем, кроме OWNER/ADMIN сообщества.
 * Никакого второго механизма паузы не заводится.
 */

/** Предел длины письма создателю. */
const MAX_MESSAGE_LENGTH = 2000;

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session;
}

/* ══════════════════ Пауза сообщества ════════════════════════════ */

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const paused = body?.paused;

  if (typeof paused !== "boolean") {
    return NextResponse.json({ error: "Ожидается поле paused (true/false)" }, { status: 400 });
  }

  const group = await prisma.group.findUnique({
    where: { id },
    select: { id: true, name: true, paused: true, isMain: true, ownerId: true },
  });
  if (!group) return NextResponse.json({ error: "Сообщество не найдено" }, { status: 404 });

  /* Главное сообщество проекта на паузу не ставится. В нём лежат общие
     каналы, куда попадают все новые участники (см. lib/mainCommunity), и
     остановка означала бы остановку всего проекта одной кнопкой. */
  if (group.isMain && paused) {
    return NextResponse.json(
      { error: "Главное сообщество проекта нельзя приостановить" },
      { status: 400 },
    );
  }

  if (group.paused === paused) {
    return NextResponse.json({ id: group.id, paused: group.paused, unchanged: true });
  }

  const updated = await prisma.group.update({
    where: { id },
    data: { paused },
    select: { id: true, paused: true },
  });

  /* Создателя ставят в известность всегда. Молчаливая пауза выглядит для
     него как поломка сайта, а не как мера, и первое, что он сделает, —
     напишет в поддержку. */
  await createNotification({
    userId: group.ownerId,
    type: "system",
    title: paused ? "Сообщество приостановлено" : "Работа сообщества возобновлена",
    body: paused
      ? `Администрация временно приостановила работу сообщества «${group.name}».`
      : `Администрация сняла приостановку с сообщества «${group.name}».`,
    actorId: session.user.id,
    entityType: "group",
    entityId: group.id,
  });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: paused ? "community.pause" : "community.resume",
    target: "group",
    targetId: group.id,
    details: `Сообщество «${group.name}»: ${paused ? "работа приостановлена" : "работа возобновлена"}`,
  });

  return NextResponse.json({ id: updated.id, paused: updated.paused });
}

/* ══════════════ Сообщение создателю сообщества ═══════════════════ */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const rawText = typeof body?.text === "string" ? body.text : "";

  const group = await prisma.group.findUnique({
    where: { id },
    select: { id: true, name: true, ownerId: true },
  });
  if (!group) return NextResponse.json({ error: "Сообщество не найдено" }, { status: 404 });

  const adminId = session.user.id;
  if (group.ownerId === adminId) {
    return NextResponse.json({ error: "Вы и есть создатель этого сообщества" }, { status: 400 });
  }

  const text = sanitizeText(rawText).trim();
  if (!text) return NextResponse.json({ error: "Текст сообщения обязателен" }, { status: 400 });
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Слишком длинное сообщение: до ${MAX_MESSAGE_LENGTH} знаков` },
      { status: 400 },
    );
  }

  /* Личная переписка администратора с создателем. Пара хранится
     отсортированной — так же, как это делает POST /api/dm, иначе на тех же
     двоих завёлся бы второй чат.

     Дружбу здесь НЕ проверяем, и это намеренно. Обычный маршрут ЛС
     требует дружбы и смотрит в чёрный список — оба правила защищают людей
     друг от друга. Здесь пишет администрация по поводу модерации, и возможность
     отказаться её выслушать свела бы меру к нулю: создателю достаточно было бы
     не дружить с администратором. */
  const [u1, u2] = [adminId, group.ownerId].sort();
  let conversation = await prisma.directConversation.findFirst({
    where: { user1Id: u1, user2Id: u2, kind: "PERSONAL" },
  });
  if (!conversation) {
    try {
      conversation = await prisma.directConversation.create({
        data: { user1Id: u1, user2Id: u2, kind: "PERSONAL" },
      });
    } catch {
      /* Гонка: переписку между теми же двоими могли создать параллельно —
         частичный уникальный индекс в базе отклонит вторую вставку,
         проигравший перечитывает готовую. */
      conversation = await prisma.directConversation.findFirst({
        where: { user1Id: u1, user2Id: u2, kind: "PERSONAL" },
      });
    }
  }
  if (!conversation) {
    return NextResponse.json({ error: "Не удалось открыть переписку" }, { status: 500 });
  }

  const include = {
    user: { select: { id: true, name: true, username: true, avatar: true, role: true, avatarGlowEnabled: true, avatarGlowColors: true } },
    replyTo: { select: { id: true, content: true, user: { select: { id: true, name: true } } } },
  };

  const message = await prisma.directMessage.create({
    data: {
      content: text,
      conversationId: conversation.id,
      userId: adminId,
      attachments: null,
      replyToId: null,
    },
    include,
  });

  await prisma.directConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  /* Событие обоим: создателю — чтобы сообщение пришло без перезагрузки,
     администратору — чтобы оно появилось в его собственном списке ЛС,
     если тот открыт в соседней вкладке. */
  for (const recipientId of [group.ownerId, adminId]) {
    emitToUser(recipientId, SOCKET_EVENTS.DM_MESSAGE, {
      ...message,
      conversationId: conversation.id,
    });
  }

  await createNotification({
    userId: group.ownerId,
    type: "dm",
    title: "Сообщение от администрации",
    body: `По сообществу «${group.name}»: ${text.slice(0, 120)}`,
    link: `/dm?dm=${conversation.id}`,
    actorId: adminId,
    entityType: "dm",
    entityId: conversation.id,
  });

  await logAction({
    userId: adminId,
    username: session.user.username || session.user.name || "admin",
    action: "community.message-owner",
    target: "group",
    targetId: group.id,
    details: `Сообщение создателю сообщества «${group.name}»`,
  });

  return NextResponse.json({ ok: true, conversationId: conversation.id, messageId: message.id });
}
