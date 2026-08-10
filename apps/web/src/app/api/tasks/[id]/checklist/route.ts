import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sanitizeText } from "@/lib/sanitize";
import prisma from "@/lib/prisma";

// FIX-A2: ADMIN был пропущен в списке ролей с правом редактирования.
const EDIT_ROLES = ["OWNER", "ADMIN", "MODERATOR"];
const CLOSED_STATUSES = ["done", "failed", "needs_clarification"];

async function loadAndAuthorize(taskId: string, userId: string) {
  const task = await prisma.channelTask.findUnique({
    where: { id: taskId },
    select: { id: true, creatorId: true, assigneeId: true, status: true, channel: { select: { groupId: true } } },
  });
  if (!task) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: task.channel.groupId } },
  });
  if (!membership) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  // Anyone who can manage the task, plus its current assignee, may work the checklist.
  const canEdit =
    EDIT_ROLES.includes(membership.role) ||
    task.creatorId === userId ||
    task.assigneeId === userId;
  return { task, canEdit };
}

// POST — add a checklist item
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session.user.id);
  if (auth.error) return auth.error;
  if (!auth.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (CLOSED_STATUSES.includes(auth.task!.status)) {
    return NextResponse.json({ error: "Задача закрыта и не может быть изменена" }, { status: 409 });
  }

  const { text } = await req.json();
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const last = await prisma.taskChecklistItem.findFirst({
    where: { taskId: id },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const item = await prisma.taskChecklistItem.create({
    data: {
      taskId: id,
      text: sanitizeText(text).slice(0, 200),
      order: (last?.order ?? -1) + 1,
    },
    select: { id: true, text: true, done: true, order: true },
  });

  return NextResponse.json({ item }, { status: 201 });
}

// PATCH — toggle done, edit text, or reorder an item
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session.user.id);
  if (auth.error) return auth.error;
  if (!auth.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (CLOSED_STATUSES.includes(auth.task!.status)) {
    return NextResponse.json({ error: "Задача закрыта и не может быть изменена" }, { status: 409 });
  }

  const { itemId, done, text, order } = await req.json();
  if (typeof itemId !== "string" || !itemId) {
    return NextResponse.json({ error: "itemId required" }, { status: 400 });
  }

  const existing = await prisma.taskChecklistItem.findUnique({ where: { id: itemId }, select: { taskId: true } });
  if (!existing || existing.taskId !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof done === "boolean") data.done = done;
  if (typeof text === "string" && text.trim()) data.text = sanitizeText(text).slice(0, 200);
  if (typeof order === "number" && Number.isFinite(order)) data.order = order;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const item = await prisma.taskChecklistItem.update({
    where: { id: itemId },
    data: data as never,
    select: { id: true, text: true, done: true, order: true },
  });

  return NextResponse.json({ item });
}

// DELETE — remove a checklist item (?itemId=)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session.user.id);
  if (auth.error) return auth.error;
  if (!auth.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const itemId = req.nextUrl.searchParams.get("itemId");
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

  const existing = await prisma.taskChecklistItem.findUnique({ where: { id: itemId }, select: { taskId: true } });
  if (!existing || existing.taskId !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.taskChecklistItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
