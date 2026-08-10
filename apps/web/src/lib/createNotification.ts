import { SOCKET_EVENTS } from "@trioz/shared";
import prisma from "@/lib/prisma";
import { getIO } from "@/lib/socketEmit";
import { queuePush } from "@/lib/push";

/**
 * Предмет уведомления: о чём оно.
 *
 * Появилось из бага «прочёл — не пропало». Раньше пометка о прочтении искала
 * уведомления сопоставлением ТЕКСТА ссылки, и у обращений сопоставить было
 * нечего: ссылка ведёт в раздел, а не в заявку. Предмет заменяет догадку точным
 * признаком — и заодно позволяет убрать уведомления вместе с самим предметом.
 */
export interface NotificationSubject {
  /** Из-за кого уведомление. Удалят аккаунт — уведомление уйдёт с ним (каскад). */
  actorId?: string | null;
  /** Вид предмета: appeal | dm | channel и тому подобное. */
  entityType?: string | null;
  /** Идентификатор предмета: заявки, разговора, канала. */
  entityId?: string | null;
}

export async function createNotification(params: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /**
   * Значение notifyPush, если оно уже известно вызывающему. Нужно там, где
   * уведомления создаются пачкой: иначе на каждого получателя уходил бы
   * лишний запрос в базу за одним булевым полем.
   */
  pushEnabled?: boolean;
}) {
  // Багфикс: раньше notifyPush=false полностью отменял создание уведомления —
  // пропадала и история в колокольчике/на странице уведомлений. Теперь запись
  // в журнале создаётся всегда, а флаг pushEnabled в socket-событии сообщает
  // клиентам (в т.ч. десктопной оболочке), что нативный тост показывать не надо.
  let pushEnabled = params.pushEnabled;
  if (pushEnabled === undefined) {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { notifyPush: true },
    });
    pushEnabled = user?.notifyPush !== false;
  }

  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      link: params.link,
      /* Никогда не уведомляем «из-за самого получателя»: такая связь означала бы,
         что уведомление исчезнет вместе с ним и так (по userId), а смысла в ней
         нет. */
      actorId: params.actorId && params.actorId !== params.userId ? params.actorId : null,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
    },
  });

  const io = getIO();
  if (io) {
    io.to(`dm-${params.userId}`).emit(SOCKET_EVENTS.NEW_NOTIFICATION, { ...notification, pushEnabled });
  }

  /* PUSH: доставка в ЗАКРЫТОЕ приложение. Событие выше доходит только до живого
     соединения — свернули приложение, система его выгрузила, и человек не узнаёт
     ни о чём до следующего запуска. Отправка стоит здесь, в единственном месте,
     где рождаются уведомления: так ни один путь её не пропустит.

     Не ждём: доставка идёт через чужую службу, а тот, кто отправил сообщение, не
     должен смотреть на крутящуюся кнопку. Выключатель уведомлений в настройках
     аккаунта проверяет сама отправка (см. lib/push). */
  if (pushEnabled !== false) {
    queuePush([params.userId], {
      title: params.title,
      body: params.body,
      link: params.link,
      /* Метка схлопывает уведомления одной беседы в одно — как это делает
         оболочка для живых уведомлений. */
      tag: params.entityId ? `${params.entityType ?? "n"}:${params.entityId}` : params.type,
    });
  }

  return notification;
}

/**
 * Уведомление сразу многим — два запроса вместо двух на каждого получателя.
 *
 * Зачем понадобилось: @everyone в сообществе на тысячу человек и рассылка из
 * админки шли циклом с `await` внутри. Каждый круг — запрос за notifyPush и
 * запрос на вставку, то есть две тысячи обращений к базе в одном HTTP-запросе,
 * последовательно. Рассылка успевала упереться в таймаут, а база всё это время
 * была занята.
 *
 * Здесь: одна выборка настроек, одна вставка (createManyAndReturn возвращает
 * созданные строки, поэтому клиентам по-прежнему уходит уведомление с id — без
 * него клиент не смог бы отличить его от уже показанного).
 *
 * Возвращает число созданных записей.
 */
export async function createNotificationsBulk(params: {
  userIds: string[];
  type: string;
  title: string;
  body?: string;
  link?: string;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<number> {
  const userIds = Array.from(new Set(params.userIds)).filter(Boolean);
  if (userIds.length === 0) return 0;

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, notifyPush: true },
  });
  const pushByUser = new Map(users.map((user) => [user.id, user.notifyPush !== false]));

  const created = await prisma.notification.createManyAndReturn({
    data: userIds.map((userId) => ({
      userId,
      type: params.type,
      title: params.title,
      body: params.body,
      link: params.link,
      actorId: params.actorId && params.actorId !== userId ? params.actorId : null,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
    })),
  });

  const io = getIO();
  if (io) {
    for (const notification of created) {
      io.to(`dm-${notification.userId}`).emit(SOCKET_EVENTS.NEW_NOTIFICATION, {
        ...notification,
        pushEnabled: pushByUser.get(notification.userId) !== false,
      });
    }
  }

  /* PUSH: одной отправкой на всех, кому она разрешена. Список получателей
     фильтрует сама отправка, но заведомо выключивших не тащим и сюда. */
  const pushTargets = userIds.filter((userId) => pushByUser.get(userId) !== false);
  if (pushTargets.length > 0) {
    queuePush(pushTargets, {
      title: params.title,
      body: params.body,
      link: params.link,
      tag: params.entityId ? `${params.entityType ?? "n"}:${params.entityId}` : params.type,
    });
  }

  return created.length;
}

/**
 * Погасить уведомления получателя по предмету: он его открыл и прочитал.
 *
 * Это и есть починка бага «перешёл, прочёл — уведомление не пропало». Раньше
 * пометка искала записи по тексту ссылки: для личных сообщений — по `dm=<id>&`,
 * для деловых — по `section=business`, а для обращений в админке ссылка ведёт в
 * раздел целиком, и совпасть с ней могло только всё сразу или ничего. Ничего и
 * совпадало.
 *
 * Старые записи (без предмета) при этом не бросаем: их можно погасить прежним
 * способом, передав `legacyWhere`. Иначе починка выглядела бы как «у меня всё
 * равно висит непрочитанное» — просто потому, что записи созданы до неё.
 *
 * Возвращает, сколько погасили, и сколько непрочитанных осталось: счётчик в
 * колокольчике обновляется этим числом, а не пересчётом на клиенте.
 */
export async function markSubjectNotificationsRead(params: {
  userId: string;
  entityType: string;
  entityId: string;
  /** Как найти записи, созданные до появления предмета. */
  legacyWhere?: Record<string, unknown>;
}): Promise<{ marked: number; unreadLeft: number }> {
  const bySubject = {
    userId: params.userId,
    read: false,
    entityType: params.entityType,
    entityId: params.entityId,
  };
  const where = params.legacyWhere
    ? { userId: params.userId, read: false, OR: [bySubject, params.legacyWhere] }
    : bySubject;

  const marked = await prisma.notification.updateMany({ where, data: { read: true } });
  const unreadLeft = await prisma.notification.count({ where: { userId: params.userId, read: false } });
  return { marked: marked.count, unreadLeft };
}

/**
 * Убрать уведомления о предмете, которого больше нет.
 *
 * Уведомление, ведущее в никуда, хуже отсутствия уведомления: человек идёт по
 * ссылке и не находит ничего, а запись продолжает висеть. Удаление аккаунта
 * закрыто каскадом по `actorId`, а вот удаление самой заявки или разговора —
 * этим вызовом.
 */
export async function deleteSubjectNotifications(entityType: string, entityId: string): Promise<number> {
  const deleted = await prisma.notification.deleteMany({ where: { entityType, entityId } });
  return deleted.count;
}
