import prisma from "@/lib/prisma";
import { createNotification, createNotificationsBulk } from "@/lib/createNotification";
import { STAFF_ROLES } from "@/lib/businessChat";
import {
  mailNewAppeal,
  mailAppealReplyToClient,
  mailAppealReplyToStaff,
  mailAppealStatus,
} from "@/lib/appealMail";

/**
 * Уведомления по обращениям — в одном месте, потому что раньше их не было почти
 * нигде.
 *
 * Как было: уведомление уходило РОВНО один раз — администраторам при создании
 * обращения. Дальше переписка шла молча. Администратор отвечал — автор об этом
 * не узнавал никак; менял статус на «закрыто» — тоже; автор дописывал вопрос —
 * администраторы не узнавали. Обращение спокойно висело неделю, потому что
 * сообщить о нём было нечем.
 *
 * Кого считать разбирающим: роли ADMIN и EDITOR. Именно так решают оба
 * под-маршрута обращения (`isAdmin` там включает EDITOR), а уведомление о новом
 * обращении уходило только ADMIN — редакторы не знали о работе, которую им
 * поручено делать.
 *
 * Себя не уведомляем: человек только что сам это и написал.
 *
 * ── Уведомление и письмо ходят парой ────────────────────────────────────────
 *
 * Каждое событие обращения даёт две вещи: запись в колокольчике и письмо на
 * почту (lib/appealMail). Они здесь рядом намеренно: разведи их по разным
 * местам — и одно неминуемо начнёт отставать от другого, как это уже случилось
 * с самими уведомлениями. Кому письмо не нужно, тот выключает его галочкой
 * (`User.notifyEmail`), а не отсутствием кода.
 *
 * Письма НЕ ждём: у почтового запроса свой таймаут в 15 секунд, и человек,
 * отправивший заявку, не должен смотреть на крутящуюся кнопку, пока
 * администратору уходит письмо. Приложение — отдельный процесс Node
 * (server.ts), отправка спокойно доживает до конца после ответа.
 */

/** Ссылка на обращение для получателя. Разбирающие идут в админку, автор — к себе. */
const ADMIN_LINK = "/admin/appeals";
/** Вид предмета для уведомлений по обращениям. */
export const APPEAL_ENTITY = "appeal";
const AUTHOR_LINK = "/settings/notifications";

/** Отправка письма «в фон»: ответ пользователю её не ждёт, ошибка — в журнал. */
function queueMail(sending: Promise<unknown>): void {
  void sending.catch((err) => console.warn("[appealNotify] письмо не ушло", err));
}

/** Короткая выжимка ответа для тела уведомления. */
function excerpt(text: string, limit = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** Кому поручено разбирать обращения. Себя из списка убираем. */
export async function appealHandlerIds(excludeUserId?: string): Promise<string[]> {
  const handlers = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    select: { id: true },
  });
  /* Типы указаны явно: без сгенерированного клиента Prisma вывод даёт any, и
     под noImplicitAny сборка спотыкается на пустом месте. */
  return handlers
    .map((handler: { id: string }) => handler.id)
    .filter((id: string) => id !== excludeUserId);
}

/** Новое обращение: сообщаем всем, кто их разбирает. */
export async function notifyNewAppeal(params: {
  /** Заявка, о которой уведомляем. Предмет уведомления: открыли заявку — погасло. */
  appealId: string;
  actorId: string;
  authorName: string;
  subject: string;
  isBanAppeal: boolean;
  /** Текст заявки: уходит в письмо, чтобы по нему можно было решить без входа. */
  body?: string;
}): Promise<void> {
  const userIds = await appealHandlerIds(params.actorId);
  await createNotificationsBulk({
    userIds,
    type: "appeal",
    title: params.isBanAppeal ? "Новое обжалование блокировки" : "Новое обращение пользователя",
    body: `${params.authorName}: ${params.subject}`,
    link: ADMIN_LINK,
    /* Из-за кого и о чём. Без этого уведомление жило дольше своего повода:
       заявку прочитали — оно висело непрочитанным, аккаунт удалили — висело с
       именем, которого больше нет. */
    actorId: params.actorId,
    entityType: APPEAL_ENTITY,
    entityId: params.appealId,
  });
  queueMail(
    mailNewAppeal({
      userIds,
      authorName: params.authorName,
      subject: params.subject,
      body: params.body ?? "",
      isBanAppeal: params.isBanAppeal,
    }),
  );
}

/** Ответ в обращении: сообщаем противоположной стороне. */
export async function notifyAppealReply(params: {
  appealId: string;
  actorId: string;
  actorName: string;
  authorId: string;
  subject: string;
  body: string;
  fromAdmin: boolean;
}): Promise<void> {
  if (params.fromAdmin) {
    // Автор ждёт именно этого: ему ответили.
    if (params.authorId === params.actorId) return;
    await createNotification({
      userId: params.authorId,
      type: "appeal",
      title: "Ответ по вашему обращению",
      body: `${params.subject}: ${excerpt(params.body)}`,
      link: AUTHOR_LINK,
      actorId: params.actorId,
      entityType: APPEAL_ENTITY,
      entityId: params.appealId,
    });
    queueMail(
      mailAppealReplyToClient({
        userId: params.authorId,
        subject: params.subject,
        body: params.body,
      }),
    );
    return;
  }
  // Дописал автор — об этом должны узнать разбирающие, иначе дополнение к
  // обращению повисает без ответа.
  const userIds = await appealHandlerIds(params.actorId);
  await createNotificationsBulk({
    userIds,
    type: "appeal",
    title: "Дополнение к обращению",
    body: `${params.actorName}: ${excerpt(params.body)}`,
    link: ADMIN_LINK,
    actorId: params.actorId,
    entityType: APPEAL_ENTITY,
    entityId: params.appealId,
  });
  queueMail(
    mailAppealReplyToStaff({
      userIds,
      actorName: params.actorName,
      subject: params.subject,
      body: params.body,
    }),
  );
}

/** Человеческие названия состояний: в уведомлении «IN_PROGRESS» бесполезен. */
const STATUS_LABELS: Record<string, string> = {
  OPEN: "открыто",
  IN_PROGRESS: "в работе",
  CLOSED: "закрыто",
};

/** Смена статуса: сообщаем автору. Он не следит за админкой. */
export async function notifyAppealStatus(params: {
  appealId: string;
  actorId: string;
  authorId: string;
  subject: string;
  status: string;
}): Promise<void> {
  if (params.authorId === params.actorId) return;
  const label = STATUS_LABELS[params.status] ?? params.status;
  await createNotification({
    userId: params.authorId,
    type: "appeal",
    title: `Обращение ${label}`,
    body: params.subject,
    link: AUTHOR_LINK,
    actorId: params.actorId,
    entityType: APPEAL_ENTITY,
    entityId: params.appealId,
  });
  queueMail(
    mailAppealStatus({
      userId: params.authorId,
      subject: params.subject,
      statusLabel: label,
    }),
  );
}
