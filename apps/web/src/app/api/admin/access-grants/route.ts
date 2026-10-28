import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, invalidateUserAuthCache } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { tzIdSameOrigin } from "@/lib/tzIdOrigin";
import { emitToUser } from "@/lib/socketEmit";
import type { Prisma } from "@prisma/client";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Требуется администратор основного проекта" }, { status: 403 });
  if (!tzIdSameOrigin(req)) return NextResponse.json({ error: "Неверный источник запроса" }, { status: 403 });
  try {
    const b = await req.json();
    if (!["VPN", "PREMIUM"].includes(b.kind) || typeof b.userId !== "string" || b.userId.length > 100 || !["grant", "revoke"].includes(b.action)) throw Error("Некорректное действие");
    if (typeof b.reason !== "string" || b.reason.trim().length < 5 || b.reason.length > 1000) throw Error("Укажите основание: от 5 до 1000 символов");
    if (b.action === "grant" && (![0, 1, 3, 6, 12].includes(b.months) || typeof b.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(b.requestId))) throw Error("Выберите срок и повторите действие");
    if (b.action === "revoke" && (typeof b.id !== "string" || !b.id.startsWith("admin-grant-"))) throw Error("Можно отозвать только ручное назначение");
    const id = b.action === "grant" ? `admin-grant-${b.requestId}` : b.id;
    const result = await prisma.$transaction(async tx => {
      const user = await tx.user.findFirst({ where: { id: b.userId, isDeleted: false } });
      if (!user) throw Error("Пользователь не найден");
      const model = (b.kind === "PREMIUM" ? tx.premiumSubscription : tx.vpnSubscription) as Prisma.TransactionClient["premiumSubscription"];
      const existing = await model.findUnique({ where: { id } });
      if (existing && (existing.userId !== b.userId || existing.paymentMethod !== "manual-admin")) throw Error("Назначение относится к другому аккаунту");
      if (b.action === "grant" && existing) return { reused: true, granted: b.kind === "PREMIUM" ? user.isPremium : !!user.vpnAccess, until: user.vpnAccessUntil };
      if (b.action === "revoke" && !existing) throw Error("Назначение не найдено");
      if (b.action === "grant") {
        const now = new Date();
        const dates = await model.findMany({ where: { userId: b.userId, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { expiresAt: true } });
        const legacy = b.kind === "PREMIUM" ? user.isPremium : user.vpnAccess && (!user.vpnAccessUntil || user.vpnAccessUntil > now);
        if (legacy && !dates.length && !await model.findFirst({ where: { userId: user.id } })) await model.create({ data: { id: `legacy-${b.kind}-${user.id}`, userId: user.id, plan: "lifetime", paymentMethod: "manual", expiresAt: b.kind === "VPN" ? user.vpnAccessUntil : null, note: "Сохранено ранее выданное право", status: "active" } });
        // A manual period is its own entitlement, independent of pending bank payments.
        const own = await model.findMany({ where: { userId: b.userId, paymentMethod: "manual-admin", status: "active", expiresAt: { gt: now } }, select: { expiresAt: true } });
        const start = own.reduce((d, r) => r.expiresAt && r.expiresAt > d ? r.expiresAt : d, now);
        const end = new Date(start); const day = end.getUTCDate(); end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + b.months); const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate(); end.setUTCDate(Math.min(day, last));
        await model.create({ data: { id, userId: b.userId, plan: b.months === 0 ? "lifetime" : `manual-${b.months}`, amount: 0, paymentMethod: "manual-admin", expiresAt: b.months === 0 ? null : end, note: b.reason.trim(), status: "active", grantedById: session.user.id } });
      } else await model.update({ where: { id }, data: { status: "canceled" } });
      const remaining = await model.findMany({ where: { userId: b.userId, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { expiresAt: true } });
      const unlimited = remaining.some(r => r.expiresAt === null);
      const until = remaining.reduce<Date | null>((d, r) => r.expiresAt && (!d || r.expiresAt > d) ? r.expiresAt : d, null);
      await tx.user.update({ where: { id: b.userId }, data: b.kind === "PREMIUM" ? { isPremium: remaining.length > 0 } : { vpnAccess: remaining.length > 0, vpnAccessUntil: unlimited ? null : until } });
      await tx.auditLog.create({ data: { userId: session.user.id, username: session.user.username || session.user.name || "admin", action: b.action === "grant" ? "subscription.manual.grant" : "subscription.manual.revoke", target: b.kind, targetId: id, details: `${b.userId}: ${b.reason.trim()}` } });
      return { reused: false, granted: remaining.length > 0, until: unlimited ? null : until };
    }, { isolationLevel: "Serializable" });
    invalidateUserAuthCache(b.userId);
    emitToUser(b.userId, b.kind === "PREMIUM" ? "account-premium-updated" : "account-vpn-updated", b.kind === "PREMIUM" ? { isPremium: result.granted } : { vpnAccess: result.granted, vpnAccessUntil: result.until });
    return NextResponse.json({ ok: true, reused: result.reused }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error && !e.name.startsWith("Prisma") ? e.message : "Данные изменились. Обновите список и повторите действие.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
