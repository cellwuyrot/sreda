import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { emitToUser } from "@/lib/socketEmit";
import { VPN_PLANS, isVpnPlan, vpnPlanExpiry, type VpnPlan } from "@/lib/vpnPlan";

/**
 * VPN-PLAN: подключение подписки «только VPN». Только для ADMIN.
 *
 * Повторяет поведение маршрута Premium-подписок, но НИКОГДА не трогает
 * `isPremium`: подписка даёт только тумблер VPN и ничего больше. Редактор сюда не
 * допущен по той же причине, что и к Premium: это деньги и платежи.
 */

const PAYMENT_METHODS = ["sbp", "acquiring", "manual"] as const;

/** ADMIN-только. Ответ без подробностей — чтобы не подсказывать строение прав. */
async function adminOnly() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { session } as const;
}

export async function GET(req: NextRequest) {
  const guard = await adminOnly();
  if ("error" in guard) return guard.error;

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const [subscriptions, user] = await Promise.all([
    prisma.vpnSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { grantedBy: { select: { username: true, name: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { vpnAccess: true, vpnAccessUntil: true },
    }),
  ]);

  return NextResponse.json({
    subscriptions,
    vpnAccess: user?.vpnAccess ?? false,
    vpnAccessUntil: user?.vpnAccessUntil ?? null,
    plans: VPN_PLANS,
  });
}

export async function POST(req: Request) {
  const guard = await adminOnly();
  if ("error" in guard) return guard.error;
  const session = guard.session;

  const body = await req.json().catch(() => null);
  const userId: string = typeof body?.userId === "string" ? body.userId : "";
  const plan: VpnPlan = isVpnPlan(body?.plan) ? body.plan : "month";
  const paymentMethod: string = PAYMENT_METHODS.includes(body?.paymentMethod)
    ? body.paymentMethod
    : "manual";
  const amount = Number.isFinite(body?.amount) ? Math.max(0, Math.round(body.amount)) : 0;
  const reference = typeof body?.reference === "string" ? body.reference.slice(0, 200) : null;
  const note = typeof body?.note === "string" ? body.note.slice(0, 2000) : null;

  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, vpnAccess: true, vpnAccessUntil: true },
  });
  if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const startedAt = new Date();

  /* Продление считается ОТ КОНЦА действующего срока, а не от сегодня. Иначе
     человек, заплативший за второй месяц за неделю до конца первого, терял бы
     эту неделю. */
  const base =
    targetUser.vpnAccess && targetUser.vpnAccessUntil && targetUser.vpnAccessUntil > startedAt
      ? targetUser.vpnAccessUntil
      : startedAt;
  const expiresAt = vpnPlanExpiry(plan, base);

  const subscription = await prisma.vpnSubscription.create({
    data: {
      userId,
      plan,
      paymentMethod,
      amount,
      reference,
      note,
      status: "active",
      startedAt,
      expiresAt,
      grantedById: session.user.id,
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { vpnAccess: true, vpnAccessUntil: expiresAt },
  });
  emitToUser(userId, "account-vpn-updated", { vpnAccess: true, vpnAccessUntil: expiresAt });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "VpnSubscription",
    targetId: userId,
    details: `Подписка «Ускоренный интернет» «${plan}» для "${targetUser.username}" · оплата: ${paymentMethod} · ${amount}₽${reference ? ` · ${reference}` : ""}`,
  });

  return NextResponse.json({ subscription, vpnAccess: true, vpnAccessUntil: expiresAt });
}

export async function PATCH(req: Request) {
  const guard = await adminOnly();
  if ("error" in guard) return guard.error;
  const session = guard.session;

  const body = await req.json().catch(() => null);
  const subscriptionId: string = typeof body?.subscriptionId === "string" ? body.subscriptionId : "";
  if (!subscriptionId || body?.status !== "canceled") {
    return NextResponse.json(
      { error: "subscriptionId and status=canceled required" },
      { status: 400 },
    );
  }

  const sub = await prisma.vpnSubscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  await prisma.vpnSubscription.update({
    where: { id: subscriptionId },
    data: { status: "canceled" },
  });

  /* Доступ снимаем только если других действующих записей не осталось. */
  const remaining = await prisma.vpnSubscription.findMany({
    where: { userId: sub.userId, status: "active" },
    select: { expiresAt: true },
    orderBy: [{ expiresAt: "desc" }],
  });

  let until: Date | null = null;
  if (remaining.length > 0) {
    // Бессрочная запись (`null`) сильнее любой даты.
    until = remaining.some((r) => r.expiresAt === null) ? null : remaining[0].expiresAt;
    await prisma.user.update({
      where: { id: sub.userId },
      data: { vpnAccess: true, vpnAccessUntil: until },
    });
  } else {
    await prisma.user.update({
      where: { id: sub.userId },
      data: { vpnAccess: false, vpnAccessUntil: null },
    });
    emitToUser(sub.userId, "account-vpn-updated", { vpnAccess: false });
  }

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "VpnSubscription",
    targetId: sub.userId,
    details: `Отмена подписки на соединение ${subscriptionId} (осталось активных: ${remaining.length})`,
  });

  return NextResponse.json({
    success: true,
    vpnAccess: remaining.length > 0,
    vpnAccessUntil: until,
  });
}
