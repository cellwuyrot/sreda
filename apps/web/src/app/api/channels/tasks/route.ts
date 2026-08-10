import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createNotification } from "@/lib/createNotification";
import { getChannelPermissions } from "@/lib/connectPermissions";

// FIX-SEC-IDOR: этот легаси-роут раньше проверял только наличие сессии — любой
// вошедший пользователь мог читать/создавать/менять/удалять задачи в ЧУЖИХ
// каналах по channelId/taskId. Теперь каждый обработчик проверяет членство и
// права через getChannelPermissions (единый механизм авторизации проекта).

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

// Проверяет, что пользователь состоит в группе канала (для валидного assignee).
async function isGroupMember(userId: string, groupId: string): Promise<boolean> {
  const m = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    select: { id: true },
  });
  return m !== null;
}

/* GET — list tasks for a channel */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  // FIX-SEC-IDOR: только участник, которому канал виден.
  const perm = await getChannelPermissions(session.user.id, channelId);
  if (!perm?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tasks = await prisma.channelTask.findMany({
    where: { channelId },
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      assignee: { select: { id: true, name: true, avatar: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(tasks);
}

/* POST — create a task */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId, title, description, assigneeId, priority, dueDate } = await req.json();

  if (!channelId || !title) {
    return NextResponse.json({ error: "channelId and title required" }, { status: 400 });
  }

  // FIX-SEC-IDOR: создавать задачи может только тот, кто вправе писать в канал.
  const perm = await getChannelPermissions(session.user.id, channelId);
  if (!perm?.canPost) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // FIX-SEC-VALIDATION: ограничения длины и enum, чтобы нельзя было записать
  // произвольные значения; назначить можно только участника той же группы.
  const safeTitle = String(title).slice(0, 200);
  const safeDescription = description != null ? String(description).slice(0, 4000) : null;
  const safePriority = PRIORITIES.has(priority) ? priority : "normal";
  let safeAssignee: string | null = null;
  if (assigneeId) {
    if (!(await isGroupMember(assigneeId, perm.groupId))) {
      return NextResponse.json({ error: "Assignee is not a member of this group" }, { status: 400 });
    }
    safeAssignee = assigneeId;
  }

  const task = await prisma.channelTask.create({
    data: {
      channelId,
      creatorId: session.user.id,
      title: safeTitle,
      description: safeDescription,
      assigneeId: safeAssignee,
      priority: safePriority,
      dueDate: dueDate ? new Date(dueDate) : null,
    },
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      assignee: { select: { id: true, name: true, avatar: true } },
      channel: { select: { groupId: true } },
    },
  });

  // Notify assignee
  if (safeAssignee && safeAssignee !== session.user.id) {
    createNotification({
      userId: safeAssignee,
      type: "system",
      title: "Новая задача",
      body: `${session.user.name} назначил вам задачу: ${safeTitle}`,
      link: `/connect?group=${task.channel.groupId}&channel=${channelId}&task=${task.id}`,
    }).catch(() => {});
  }

  return NextResponse.json(task, { status: 201 });
}

/* PATCH — update a task */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId, status, assigneeId, title, description, priority, dueDate } = await req.json();

  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });

  const task = await prisma.channelTask.findUnique({ where: { id: taskId } });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // FIX-SEC-IDOR: изменять задачу может создатель, назначенный исполнитель или
  // модератор/админ группы канала — но только внутри своей группы.
  const perm = await getChannelPermissions(session.user.id, task.channelId);
  if (!perm) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const mayEdit =
    perm.canView &&
    (task.creatorId === session.user.id || task.assigneeId === session.user.id || perm.canModerate);
  if (!mayEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data: Record<string, unknown> = {};
  if (status !== undefined) data.status = String(status).slice(0, 40);
  if (assigneeId !== undefined) {
    if (assigneeId && !(await isGroupMember(assigneeId, perm.groupId))) {
      return NextResponse.json({ error: "Assignee is not a member of this group" }, { status: 400 });
    }
    data.assigneeId = assigneeId || null;
  }
  if (title !== undefined) data.title = String(title).slice(0, 200);
  if (description !== undefined) data.description = description != null ? String(description).slice(0, 4000) : null;
  if (priority !== undefined) data.priority = PRIORITIES.has(priority) ? priority : task.priority;
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;

  const updated = await prisma.channelTask.update({
    where: { id: taskId },
    data,
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      assignee: { select: { id: true, name: true, avatar: true } },
      channel: { select: { groupId: true } },
    },
  });

  // Notify if reassigned
  if (assigneeId && assigneeId !== session.user.id && assigneeId !== task.assigneeId) {
    createNotification({
      userId: assigneeId,
      type: "system",
      title: "Задача назначена",
      body: `${session.user.name} назначил вам задачу: ${updated.title}`,
      link: `/connect?group=${updated.channel.groupId}&channel=${updated.channelId}&task=${updated.id}`,
    }).catch(() => {});
  }

  return NextResponse.json(updated);
}

/* DELETE — delete a task */
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });

  const task = await prisma.channelTask.findUnique({ where: { id: taskId } });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // FIX-SEC-IDOR: удаление — создателем-участником или модератором/админом
  // группы. Платформенный ADMIN сохраняет доступ для модерации.
  const perm = await getChannelPermissions(session.user.id, task.channelId);
  const mayDelete =
    session.user.role === "ADMIN" ||
    (!!perm?.canView && (task.creatorId === session.user.id || perm.canModerate));
  if (!mayDelete) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.channelTask.delete({ where: { id: taskId } });
  return NextResponse.json({ ok: true });
}
