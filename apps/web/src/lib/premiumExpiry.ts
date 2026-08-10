import prisma from "@/lib/prisma";
import { PREMIUM_ROLE } from "@/lib/premium";
import { emitToUser } from "@/lib/socketEmit";

/**
 * Срок подписки Premium.
 *
 * Поле `expiresAt` у подписки заполнялось при выдаче (месяц → +1 месяц), но
 * никто его не проверял: `User.isPremium` оставался `true` навсегда, и подписка
 * «на месяц» работала бессрочно. Здесь этот срок начинает действовать.
 *
 * Роль администратора даёт премиум сама по себе (lib/premium) — её эта задача не
 * касается: у администратора подписки обычно нет вовсе, а если есть, флаг
 * `isPremium` для него всё равно ничего не решает.
 *
 * Задача идемпотентна: повторный запуск ничего не портит, поэтому её безопасно
 * гонять по расписанию и вызывать при чтении профиля.
 */

export interface PremiumExpiryResult {
  /** Подписок переведено в состояние «срок вышел». */
  subscriptionsExpired: number;
  /** У скольких людей снят флаг премиума. */
  usersDowngraded: number;
}

/**
 * Снимает премиум там, где оплаченный срок закончился.
 *
 * Порядок важен: сначала помечаем просроченные подписки, потом решаем судьбу
 * флага. Иначе у человека с двумя подписками (продлил заранее) флаг снялся бы
 * из-за старой записи, хотя новая ещё действует.
 */
export async function expireOverduePremium(now: Date = new Date()): Promise<PremiumExpiryResult> {
  const overdue = await prisma.premiumSubscription.findMany({
    where: { status: "active", expiresAt: { not: null, lt: now } },
    select: { id: true, userId: true },
  });
  if (overdue.length === 0) return { subscriptionsExpired: 0, usersDowngraded: 0 };

  await prisma.premiumSubscription.updateMany({
    where: { id: { in: overdue.map((sub) => sub.id) } },
    data: { status: "expired" },
  });

  const userIds = [...new Set(overdue.map((sub) => sub.userId))];

  /* Кто ещё под действующей подпиской — тем флаг не трогаем. Один запрос на всех
     вместо запроса на каждого: людей с истёкшей подпиской в один тик может быть
     много, а строк подписок у каждого — единицы. */
  const stillActive = await prisma.premiumSubscription.findMany({
    where: { userId: { in: userIds }, status: "active" },
    select: { userId: true },
  });
  const covered = new Set(stillActive.map((sub) => sub.userId));

  const toDowngrade = userIds.filter((id) => !covered.has(id));
  if (toDowngrade.length === 0) {
    return { subscriptionsExpired: overdue.length, usersDowngraded: 0 };
  }

  const downgraded = await prisma.user.updateMany({
    where: { id: { in: toDowngrade }, isPremium: true, role: { not: PREMIUM_ROLE } },
    data: { isPremium: false },
  });

  /* Клиенту сообщаем сразу: у него в интерфейсе метка Premium и снятые пределы,
     а на сервере уже нет. Событие то же, что при выдаче и отмене подписки. */
  for (const userId of toDowngrade) {
    emitToUser(userId, "account-premium-updated", { isPremium: false });
  }

  return { subscriptionsExpired: overdue.length, usersDowngraded: downgraded.count };
}

/**
 * Сколько полных дней осталось до конца срока. `null` — срока нет (бессрочная
 * подписка или премиум по роли).
 *
 * Округление вверх: последний день, пусть и начавшийся, — ещё оплаченный день, и
 * человеку правильнее видеть «остался 1 день», а не «0».
 */
export function premiumDaysLeft(expiresAt: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  const end = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}
