import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { checkBan } from "@/lib/banCheck";
import { sanitizeText } from "@/lib/sanitize";
import prisma from "@/lib/prisma";

// FIX-A2: ADMIN был пропущен в списке ролей с правом редактирования.
const EDIT_ROLES = ["OWNER", "ADMIN", "MODERATOR"];

// GET /api/calendar?channelId=...&from=ISO&to=ISO
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channelId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { groupId: true } });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: channel.groupId } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const where: { channelId: string; start?: { gte?: Date; lte?: Date } } = { channelId };
  if (from || to) {
    where.start = {};
    if (from) where.start.gte = new Date(from);
    if (to) where.start.lte = new Date(to);
  }

  const events = await prisma.calendarEvent.findMany({
    where: where as never,
    select: {
      id: true, title: true, description: true, location: true, color: true,
      allDay: true, start: true, end: true,
      author: { select: { id: true, name: true, username: true } },
    },
    orderBy: { start: "asc" },
    take: 1000,
  });

  // FIX-CAL-REMIND: события канала, на которые подписан текущий пользователь —
  // CalendarPanel рисует по этому списку колокольчик подписки.
  const subs = await prisma.calendarEventSubscription.findMany({
    where: { userId: session.user.id, event: { channelId } },
    select: { eventId: true },
  });

  const canEdit = EDIT_ROLES.includes(membership.role) || session.user.role === "ADMIN";
  return NextResponse.json({
    events,
    canEdit,
    currentUserId: session.user.id,
    subscribedIds: subs.map((s) => s.eventId),
  });
}

// POST /api/calendar  { channelId, title, description, location, color, allDay, start, end }
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "calendar", { limit: 60, windowMs: 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { channelId, title, description, location, color, allDay, start, end } = await req.json();
  if (!channelId || !title?.trim() || !start) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: "Title too long" }, { status: 400 });

  const startDate = new Date(start);
  if (isNaN(startDate.getTime())) return NextResponse.json({ error: "Invalid start" }, { status: 400 });
  let endDate: Date | null = null;
  if (end) {
    endDate = new Date(end);
    if (isNaN(endDate.getTime())) return NextResponse.json({ error: "Invalid end" }, { status: 400 });
    if (endDate < startDate) return NextResponse.json({ error: "End before start" }, { status: 400 });
  }

  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { groupId: true, type: true } });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  if (channel.type !== "CALENDAR") return NextResponse.json({ error: "Not a Calendar channel" }, { status: 400 });

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: channel.groupId } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!EDIT_ROLES.includes(membership.role) && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "No edit permission" }, { status: 403 });
  }

  const event = await prisma.calendarEvent.create({
    data: {
      channelId,
      authorId: session.user.id,
      title: sanitizeText(title),
      description: typeof description === "string" ? sanitizeText(description).slice(0, 5000) : null,
      location: typeof location === "string" ? sanitizeText(location).slice(0, 200) : null,
      color: typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#3b82f6",
      allDay: !!allDay,
      start: startDate,
      end: endDate,
    },
    select: {
      id: true, title: true, description: true, location: true, color: true,
      allDay: true, start: true, end: true,
      author: { select: { id: true, name: true, username: true } },
    },
  });

  return NextResponse.json({ event });
}
