import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import prisma from "@/lib/prisma";

// FIX-CAL-REMIND: подписка на событие календаря. Подписчик получит личное
// уведомление за ~15 минут до начала (тик рассылки — server.ts). Повторный
// вызов снимает подписку (переключатель-колокольчик в CalendarPanel).
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await rateLimit(req, "calendar-subscribe", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { eventId } = await req.json();
  if (typeof eventId !== "string" || !eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: { id: true, start: true, channel: { select: { groupId: true } } },
  });
  if (!event) return NextResponse.json({ error: "Событие не найдено" }, { status: 404 });

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: event.channel.groupId } },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.calendarEventSubscription.findUnique({
    where: { eventId_userId: { eventId, userId: session.user.id } },
  });

  if (existing) {
    await prisma.calendarEventSubscription.delete({ where: { id: existing.id } });
    return NextResponse.json({ subscribed: false });
  }

  if (new Date(event.start) <= new Date()) {
    return NextResponse.json({ error: "Событие уже началось" }, { status: 400 });
  }

  await prisma.calendarEventSubscription.create({
    data: { eventId, userId: session.user.id },
  });
  return NextResponse.json({ subscribed: true });
}
