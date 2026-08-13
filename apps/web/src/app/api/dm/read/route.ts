import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { emitToUser } from "@/lib/socketEmit";
import { isStaffRole } from "@/lib/businessChat";
import { markSubjectNotificationsRead } from "@/lib/createNotification";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const { conversationId } = await req.json();
  if (!conversationId) return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });

  const conv = await prisma.directConversation.findUnique({ where: { id: conversationId } });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const participant = conv.user1Id === userId || conv.user2Id === userId;
  const isBusiness = conv.kind === "BUSINESS";
  /* Деловой разговор открыт всей администрации, а не только паре: очередь
     заявок общая (см. lib/businessChat и /api/dm/[id]). */
  if (!participant && !isBusiness) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!participant) {
    const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!isStaffRole(viewer?.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const now = new Date();
  /* Отметка о прочтении хранится в двух полях — по одному на участника пары.
     Сотруднику, который читает деловой разговор по роли, а не по месту в паре,
     писать некуда: своего поля у него нет. Это не потеря — метка нужна, чтобы
     собеседник видел «прочитано», а «прочитано кем-то из администрации» никакого
     смысла для клиента не имеет. */
  if (participant) {
    /* FIX-SEC: был сырой запрос с подстановкой имени колонки в текст SQL.
       Здесь имя бралось из двух литералов и было безопасным, но сам приём
       живёт в коде и копируется дальше — уже с данными из запроса. Обычное
       обновление делает то же самое и проверяется типами. */
    await prisma.directConversation.update({
      where: { id: conversationId },
      data: conv.user1Id === userId ? { user1ReadAt: now } : { user2ReadAt: now },
    });
  }

  const peerId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;

  /* Прочитанная переписка гасит свои уведомления. Теперь — по ПРЕДМЕТУ
     (разговор), а не по тексту ссылки.

     Прежний способ искал записи сопоставлением ссылки: у делового разговора — по
     подстроке «section=business», то есть разом по всем заявкам, а у личных — по
     «dm=<id собеседника>». Первое гасило лишнее, второе держалось на том, что
     ссылка никогда не поменяет вид. Предмет точен и переживает смену ссылок.

     Записи, созданные до появления предмета, гасим прежним способом — иначе у
     людей осталось бы вечное «непрочитанное» просто по дате создания. */
  const read = await markSubjectNotificationsRead({
    userId,
    entityType: "dm",
    entityId: conversationId,
    legacyWhere: isBusiness
      ? { userId, read: false, type: "appeal", entityId: null, link: { contains: "section=business" } }
      : {
          userId,
          read: false,
          type: "dm",
          entityId: null,
          OR: [{ link: { contains: `dm=${peerId}&` } }, { link: { endsWith: `dm=${peerId}` } }],
        },
  });

  if (participant) {
    emitToUser(peerId, "dm-read", { conversationId, userId, readAt: now.toISOString() });
  }

  /* Остаток непрочитанного возвращаем клиенту: открыв чат, панель гасит цифру в
     колокольчике этим числом сразу (событие tz-notifications-read), а не ждёт
     пересинхронизации по фокусу вкладки. Без этого прочитанный чат оставлял
     «непрочитанное» в бейдже до следующего возврата во вкладку. */
  return NextResponse.json({ ok: true, unreadLeft: read.unreadLeft });
}
