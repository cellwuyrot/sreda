import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sanitizeText } from "@/lib/sanitize";
import prisma from "@/lib/prisma";

// FIX-A2: ADMIN был пропущен в списке ролей с правом редактирования.
const EDIT_ROLES = ["OWNER", "ADMIN", "MODERATOR"];

async function loadAndAuthorize(eventId: string, userId: string, userRole?: string) {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: { id: true, authorId: true, channel: { select: { groupId: true } } },
  });
  if (!event) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: event.channel.groupId } },
  });
  if (!membership) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const canManage =
    EDIT_ROLES.includes(membership.role) || userRole === "ADMIN" || event.authorId === userId;
  if (!canManage) return { error: NextResponse.json({ error: "No permission" }, { status: 403 }) };
  return { event };
}

// PATCH /api/calendar/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const auth = await loadAndAuthorize(id, session.user.id, session.user.role);
  if (auth.error) return auth.error;

  const { title, description, location, color, allDay, start, end } = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof title === "string" && title.trim()) data.title = sanitizeText(title).slice(0, 200);
  if (typeof description === "string") data.description = sanitizeText(description).slice(0, 5000);
  if (typeof location === "string") data.location = sanitizeText(location).slice(0, 200);
  if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) data.color = color;
  if (typeof allDay === "boolean") data.allDay = allDay;
  if (start) {
    const d = new Date(start);
    if (!isNaN(d.getTime())) data.start = d;
  }
  if (end === null) data.end = null;
  else if (end) {
    const d = new Date(end);
    if (!isNaN(d.getTime())) data.end = d;
  }

  const event = await prisma.calendarEvent.update({
    where: { id },
    data,
    select: {
      id: true, title: true, description: true, location: true, color: true,
      allDay: true, start: true, end: true,
      author: { select: { id: true, name: true, username: true } },
    },
  });
  return NextResponse.json({ event });
}

// DELETE /api/calendar/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const auth = await loadAndAuthorize(id, session.user.id, session.user.role);
  if (auth.error) return auth.error;

  await prisma.calendarEvent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}