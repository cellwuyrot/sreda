import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  ADMINISTRATION_NAME,
  isConversationKind,
  isStaffRole,
  type ConversationKind,
} from "@/lib/businessChat";
import { checkBan } from "@/lib/banCheck";
import { freshActivity } from "@/lib/activity"; // FIX-ACT

/** Что нужно от обращения списку разговоров: тема и состояние. */
interface AppealBrief {
  id: string;
  subject: string;
  status: string;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const userId = session.user.id;

    /* Вид разговора: «Сообщения» показывают личную переписку, «Бизнес» —
       разговоры по обращениям. По умолчанию личные, иначе прежние вызовы этого
       маршрута внезапно начали бы показывать заявки среди переписки с друзьями. */
    const { searchParams } = new URL(req.url);
    const requestedKind = searchParams.get("kind")?.toUpperCase();
    const kind: ConversationKind = isConversationKind(requestedKind) ? requestedKind : "PERSONAL";

    /* Деловая очередь у администрации общая: администратор и редактор видят ВСЕ
       деловые разговоры, а не только те, где стоят в паре. Иначе заявка,
       доставшаяся отсутствующему человеку, недоступна остальным — а разбирать её
       всё равно кому-то надо. Личная переписка так не работает и работать не
       должна: там участие в паре и есть право читать. */
    const isStaff = isStaffRole(session.user.role);
    const staffQueue = kind === "BUSINESS" && isStaff;

    const conversations = await prisma.directConversation.findMany({
      where: staffQueue ? { kind } : { kind, OR: [{ user1Id: userId }, { user2Id: userId }] },
      include: {
        user1: { select: { id: true, name: true, username: true, avatar: true, role: true, lastSeen: true, customStatus: true, statusEmoji: true, activityStatus: true, activityUpdatedAt: true, avatarGlowEnabled: true, avatarGlowColors: true } }, // FIX-ACT: + activity*
        user2: { select: { id: true, name: true, username: true, avatar: true, role: true, lastSeen: true, customStatus: true, statusEmoji: true, activityStatus: true, activityUpdatedAt: true, avatarGlowEnabled: true, avatarGlowColors: true } }, // FIX-ACT: + activity*
        handler: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, content: true, createdAt: true, userId: true },
        },
      },
      orderBy: { lastMessageAt: "desc" },
    });

    /* Тема обращения — единственное, чего нет в самом разговоре: связь с
       обращением хранится идентификатором, отдельной связи в схеме нет. Один
       запрос на весь список, а не по одному на строку. */
    const appealIds = conversations
      .map((c: { appealId: string | null }) => c.appealId)
      .filter((id: string | null): id is string => !!id);
    const appeals = appealIds.length
      ? await prisma.appeal.findMany({
          where: { id: { in: appealIds } },
          select: { id: true, subject: true, status: true },
        })
      : [];
    /* Тип пары указан явно: без него map отдаёт массив, а не кортеж, и Map
       получается со значением {} — тема с состоянием пропадают на сборке. */
    const appealById = new Map<string, AppealBrief>(
      appeals.map((appeal: AppealBrief): [string, AppealBrief] => [appeal.id, appeal]),
    );

    const result = conversations.map((c) => {
      const lastMessage = c.messages[0] || null;

      /* У делового разговора клиент — всегда user1 (см. схему и lib/businessChat).
         Клиент разговаривает с администрацией, а не с человеком: подменяем сторону
         подписью, чтобы передача заявки другому сотруднику не выглядела для него
         сменой собеседника. Администрация, наоборот, видит клиента. */
      if (c.kind === "BUSINESS") {
        const viewerIsClient = c.user1Id === userId;
        const appeal = c.appealId ? appealById.get(c.appealId) : undefined;
        const other = viewerIsClient
          ? {
              /* Идентификатор — постоянное место администрации в разговоре, а не
                 текущий отвечающий: он меняется, а собеседник для клиента — нет. */
              id: c.user2Id,
              name: ADMINISTRATION_NAME,
              username: "administration",
              avatar: null,
              role: "ADMIN",
              lastSeen: null,
              customStatus: null,
              statusEmoji: null,
              activityStatus: null,
              activityUpdatedAt: null,
              avatarGlowEnabled: false,
              avatarGlowColors: null,
            }
          : { ...c.user1, customStatus: c.user1.customStatus ?? freshActivity(c.user1) };
        return {
          id: c.id,
          other,
          lastMessage,
          lastMessageAt: c.lastMessageAt,
          /* FIX-DM-SORT: начало переписки — по нему список строит порядок. */
          createdAt: c.createdAt,
          business: {
            appealId: c.appealId,
            subject: appeal?.subject ?? "",
            status: appeal?.status ?? "",
            party: viewerIsClient ? "client" : "handler",
            clientName: c.user1.name,
            handlerName: c.handler?.name ?? null,
            /* BUSINESS-LOCK: закрыта ли клиенту отправка. Клиенту по этому
               признаку ввод заменяется объяснением, администрации — показывается
               состояние переключателя. */
            locked: c.locked === true,
          },
        };
      }

      const rawOther = c.user1Id === userId ? c.user2 : c.user1;
      // FIX-ACT: если ручного статуса нет — показываем свежую активность с ПК
      const other = { ...rawOther, customStatus: rawOther.customStatus ?? freshActivity(rawOther) };
      /* FIX-DM-SORT: createdAt — момент начала переписки. Список ранжируется
         по нему, а не по последнему сообщению (см. DMConversationList). */
      return { id: c.id, other, lastMessage, lastMessageAt: c.lastMessageAt, createdAt: c.createdAt };
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("GET /api/dm error:", e);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { username, userId: targetUserId, isFavorite } = await req.json();
  if (!username && !targetUserId) return NextResponse.json({ error: "Username or userId required" }, { status: 400 });

  const target = targetUserId
    ? await prisma.user.findUnique({ where: { id: targetUserId } })
    : await prisma.user.findUnique({ where: { username } });
  if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  // Self-conversation is only allowed for the "Saved / Favorites" feature
  if (target.id === session.user.id && !isFavorite) {
    return NextResponse.json({ error: "Нельзя написать себе" }, { status: 400 });
  }

  // Friendship check is skipped for self-conversation (favorites)
  if (target.id !== session.user.id) {
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { senderId: session.user.id, receiverId: target.id },
          { senderId: target.id, receiverId: session.user.id },
        ],
      },
    });
    if (!friendship) return NextResponse.json({ error: "Можно писать только друзьям" }, { status: 403 });

    // FIX-DM: чёрный список блокирует любой способ начать личный чат (в обе стороны).
    try {
      const blocked = await prisma.dmUserSetting.findFirst({
        where: {
          blacklisted: true,
          OR: [
            { ownerId: target.id, targetId: session.user.id },
            { ownerId: session.user.id, targetId: target.id },
          ],
        },
        select: { ownerId: true },
      });
      if (blocked) {
        const msg = blocked.ownerId === target.id
          ? "Пользователь ограничил личные сообщения"
          : "Собеседник у вас в чёрном списке — сначала уберите его из ЧС";
        return NextResponse.json({ error: msg }, { status: 403 });
      }
    } catch { /* таблица настроек ещё не создана */ }
  }

  // Find or create conversation
  const [u1, u2] = [session.user.id, target.id].sort();
  /* Вид указываем явно: этот маршрут открывает именно личную переписку, а
     деловой разговор с тем же человеком — отдельная запись.

     Поиск через findFirst, а не findUnique: составного ключа [user1, user2, kind]
     в схеме больше нет — он не давал создать второй деловой чат тому же клиенту.
     Уникальность личной пары осталась в базе частичным индексом
     (WHERE kind = 'PERSONAL'), поэтому одновременная попытка двоих открыть одну
     переписку по-прежнему упрётся в базу: проигравший перечитывает готовую. */
  let conversation = await prisma.directConversation.findFirst({
    where: { user1Id: u1, user2Id: u2, kind: "PERSONAL" },
  });

  if (!conversation) {
    try {
      conversation = await prisma.directConversation.create({
        data: { user1Id: u1, user2Id: u2, kind: "PERSONAL" },
      });
    } catch {
      conversation = await prisma.directConversation.findFirst({
        where: { user1Id: u1, user2Id: u2, kind: "PERSONAL" },
      });
      if (!conversation) {
        return NextResponse.json({ error: "Не удалось открыть переписку" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ id: conversation.id, targetUser: target.id });
}
