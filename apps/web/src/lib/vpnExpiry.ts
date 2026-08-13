import prisma from "@/lib/prisma";
import { emitToUser } from "@/lib/socketEmit";

/**
 * VPN-PLAN: срок подписки «только VPN».
 *
 * Зачем задача, если право на туннель и так считается по дате (lib/vpnPlan):
 * потому что по дате решается только вопрос «работает ли сейчас». Состояние
 * записей при этом оставалось бы «active» навсегда, и в панели администратора
 * истёкшие подписки выглядели бы действующими, а флаг `vpnAccess` висел бы
 * включённым годами. Здесь записи приводятся в соответствие с реальностью.
 *
 * Задача идемпотентна: повторный запуск ничего не портит.
 */

export interface VpnExpiryResult {
  /** Подписок переведено в состояние «срок вышел». */
  subscriptionsExpired: number;
  /** У скольких людей снят доступ к VPN. */
  usersRevoked: number;
}

/** Снимает доступ к VPN там, где оплаченный срок закончился. */
export async function expireOverdueVpn(now: Date = new Date()): Promise<VpnExpiryResult> {
  const overdue = await prisma.vpnSubscription.findMany({
    where: { status: "active", expiresAt: { not: null, lt: now } },
    select: { id: true, userId: true },
  });
  if (overdue.length === 0) return { subscriptionsExpired: 0, usersRevoked: 0 };

  await prisma.vpnSubscription.updateMany({
    where: { id: { in: overdue.map((sub) => sub.id) } },
    data: { status: "expired" },
  });

  const userIds = [...new Set(overdue.map((sub) => sub.userId))];

  /* Кто продлил заранее — у того есть вторая действующая запись, и доступ
     трогать нельзя. Один запрос на всех вместо запроса на каждого. */
  const stillActive = await prisma.vpnSubscription.findMany({
    where: { userId: { in: userIds }, status: "active" },
    select: { userId: true, expiresAt: true },
  });
  const covered = new Map<string, Date | null>();
  for (const sub of stillActive) {
    if (!covered.has(sub.userId)) covered.set(sub.userId, sub.expiresAt);
    else {
      const prev = covered.get(sub.userId) ?? null;
      // Бессрочная запись сильнее любой даты.
      if (prev !== null && (sub.expiresAt === null || sub.expiresAt > prev)) {
        covered.set(sub.userId, sub.expiresAt);
      }
    }
  }

  const toRevoke = userIds.filter((id) => !covered.has(id));

  /* Срок у продлённых обновляем: иначе в `vpnAccessUntil` могла бы остаться
     дата истёкшей записи, и туннель упал бы у человека, который заплатил. */
  for (const [userId, until] of covered) {
    await prisma.user.update({
      where: { id: userId },
      data: { vpnAccess: true, vpnAccessUntil: until },
    });
  }

  if (toRevoke.length === 0) {
    return { subscriptionsExpired: overdue.length, usersRevoked: 0 };
  }

  const revoked = await prisma.user.updateMany({
    where: { id: { in: toRevoke }, vpnAccess: true },
    data: { vpnAccess: false, vpnAccessUntil: null },
  });

  /* Клиенту сообщаем сразу: иначе тумблер VPN в настройках остался бы
     включаемым на вид, а сервер в ответ давал бы 403. */
  for (const userId of toRevoke) {
    emitToUser(userId, "account-vpn-updated", { vpnAccess: false });
  }

  return { subscriptionsExpired: overdue.length, usersRevoked: revoked.count };
}
