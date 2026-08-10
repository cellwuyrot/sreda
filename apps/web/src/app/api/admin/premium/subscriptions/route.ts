import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { invalidateUserAuthCache } from "@/lib/auth";
import { emitToUser } from "@/lib/socketEmit";

/**
 * PREMIUM-PAY: подключение подписки Premium, привязанной к платежу.
 * Только для ADMIN. При связи с профилем клиента админ выбирает способ оплаты
 * (СБП / эквайринг), сумму и ссылку/чек — сервис выдаёт Premium и сохраняет
 * запись PremiumSubscription.
 */

const PLANS = ["month", "quarter", "year", "lifetime"] as const;
type Plan = (typeof PLANS)[number];
const PAYMENT_METHODS = ["sbp", "acquiring", "manual"] as const;

/** Срок действия подписки от даты старта (null = бессрочно). */
function computeExpiry(plan: Plan, from: Date): Date | null {
  const d = new Date(from);
  switch (plan) {
    case "month": d.setMonth(d.getMonth() + 1); return d;
    case "quarter": d.setMonth(d.getMonth() + 3); return d;
    case "year": d.setFullYear(d.getFullYear() + 1); return d;
    case "lifetime": return null;
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const subscriptions = await prisma.premiumSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { grantedBy: { select: { username: true, name: true } } },
  });
  return NextResponse.json(subscriptions);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const userId: string = body.userId;
  const plan: Plan = PLANS.includes(body.plan) ? body.plan : "month";
  const paymentMethod: string = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : "manual";
  const amount = Number.isFinite(body.amount) ? Math.max(0, Math.round(body.amount)) : 0;
  const reference = typeof body.reference === "string" ? body.reference.slice(0, 200) : null;
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;

  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, role: true } });
  if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const startedAt = new Date();
  const expiresAt = computeExpiry(plan, startedAt);

  const subscription = await prisma.premiumSubscription.create({
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

  // Выдаём Premium и сбрасываем кэш авторизации, чтобы флаг применился сразу.
  await prisma.user.update({ where: { id: userId }, data: { isPremium: true } });
  invalidateUserAuthCache(userId);
  emitToUser(userId, "account-premium-updated", { isPremium: true });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "PremiumSubscription",
    targetId: userId,
    details: `Подписка «${plan}» для "${targetUser.username}" · оплата: ${paymentMethod} · ${amount}₽${reference ? ` · ${reference}` : ""}`,
  });

  return NextResponse.json({ subscription, isPremium: true });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const subscriptionId: string = body.subscriptionId;
  if (!subscriptionId || body.status !== "canceled") {
    return NextResponse.json({ error: "subscriptionId and status=canceled required" }, { status: 400 });
  }

  const sub = await prisma.premiumSubscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  await prisma.premiumSubscription.update({ where: { id: subscriptionId }, data: { status: "canceled" } });

  // Если у пользователя не осталось активных подписок — снимаем Premium
  // (админ-роль сохраняет premium автоматически на уровне auth).
  const remaining = await prisma.premiumSubscription.count({ where: { userId: sub.userId, status: "active" } });
  if (remaining === 0) {
    await prisma.user.update({ where: { id: sub.userId }, data: { isPremium: false } });
    invalidateUserAuthCache(sub.userId);
    emitToUser(sub.userId, "account-premium-updated", { isPremium: false });
  }

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "PremiumSubscription",
    targetId: sub.userId,
    details: `Отмена подписки ${subscriptionId} (осталось активных: ${remaining})`,
  });

  return NextResponse.json({ success: true, isPremium: remaining > 0 });
}
