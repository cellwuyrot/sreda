import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { sanitizeText } from "@/lib/sanitize";
import { createNotification } from "@/lib/createNotification";
import prisma from "@/lib/prisma";

// FIX-A2: ADMIN был пропущен в списке ролей с правом редактирования.
const EDIT_ROLES = ["OWNER", "ADMIN", "MODERATOR"];
const OPEN_STATUSES = ["open", "in_progress"];
const CLOSED_STATUSES = ["done", "failed", "needs_clarification"];
const STATUSES = [...OPEN_STATUSES, ...CLOSED_STATUSES];
const PRIORITIES = ["low", "normal", "high"];
const mentionRegex = /@([A-Za-z0-9_а-яА-ЯёЁ]+)/g;

const commentSelect = {
  id: true,
  content: true,
  mentions: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, username: true } },
} as const;

const checklistSelect = {
  id: true,
  text: true,
  done: true,
  order: true,
} as const;

const attachmentSelect = {
  id: true,
  name: true,
  url: true,
  mime: true,
  size: true,
  createdAt: true,
  uploader: { select: { id: true, name: true, username: true } },
} as const;

const subtaskSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
} as const;

const taskSelect = {
  id: true,
  channelId: true,
  number: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  closedAt: true,
  tags: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true, username: true } },
  assignee: { select: { id: true, name: true, username: true } },
  closedBy: { select: { id: true, name: true, username: true } },
  comments: {
    select: commentSelect,
    orderBy: { createdAt: "asc" },
  },
  checklist: {
    select: checklistSelect,
    orderBy: { order: "asc" },
  },
  attachments: {
    select: attachmentSelect,
    orderBy: { createdAt: "asc" },
  },
  subtasks: {
    select: subtaskSelect,
    orderBy: { number: "asc" },
  },
  parent: { select: { id: true, number: true, title: true } },
} as const;

function normalizeTags(input: unknown): string {
  if (!input) return "";
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const cleaned = Array.from(
    new Set(
      list
        .map((t) => (typeof t === "string" ? t.trim().toLowerCase().slice(0, 30) : ""))
        .filter(Boolean),
    ),
  ).slice(0, 10);
  return cleaned.join(",");
}

async function loadAndAuthorize(taskId: string, userId: string) {
  const task = await prisma.channelTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      creatorId: true,
      assigneeId: true,
      channelId: true,
      status: true,
      channel: { select: { groupId: true } },
    },
  });
  if (!task) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: task.channel.groupId } },
  });
  if (!membership) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const canManage = EDIT_ROLES.includes(membership.role) || task.creatorId === userId;
  return { task, membership, canManage };
}

async function resolveMentions(channelId: string, text: string) {
  const usernames = Array.from(new Set(Array.from(text.matchAll(mentionRegex), (match) => match[1]?.toLowerCase()).filter(Boolean)));
  if (usernames.length === 0) return [] as { id: string; username: string; name: string }[];

  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { groupId: true } });
  if (!channel) return [];

  const members = await prisma.groupMember.findMany({
    where: { groupId: channel.groupId },
    select: { user: { select: { id: true, username: true, name: true } } },
  });

  return members.map((entry) => entry.user).filter((user) => usernames.includes(user.username.toLowerCase()));
}

async function notifyUsers(userIds: string[], senderId: string, title: string, body: string, link = "/connect") {
  await Promise.all(
    userIds
      .filter((userId, index, array) => userId !== senderId && array.indexOf(userId) === index)
      .map((userId) =>
        createNotification({
          userId,
          type: "mention",
          title,
          body,
          link,
        }).catch(() => null),
      ),
  );
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session.user.id);
  if (auth.error) return auth.error;

  const task = await prisma.channelTask.findUnique({ where: { id }, select: taskSelect });
  return NextResponse.json({ task });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session.user.id);
  if (auth.error) return auth.error;

  const body = await req.json();
  const data: Record<string, unknown> = {};
  const isAssignee = auth.task!.assigneeId === session.user.id;
  const isClosed = CLOSED_STATUSES.includes(auth.task!.status);

  // A closed task is immutable: it cannot be reopened or edited.
  if (isClosed) {
    return NextResponse.json({ error: "Задача закрыта и не может быть изменена" }, { status: 409 });
  }

  if (typeof body.status === "string" && STATUSES.includes(body.status)) {
    const isClosing = CLOSED_STATUSES.includes(body.status);
    if (!auth.canManage && !isAssignee && body.status !== "in_progress") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (isClosing) {
      // Closing is irreversible, so the client must explicitly confirm it.
      if (body.confirmClose !== true) {
        return NextResponse.json({ error: "Закрытие задачи необратимо — требуется подтверждение (confirmClose)" }, { status: 400 });
      }
      data.closedAt = new Date();
      data.closedById = session.user.id;
    }
    data.status = body.status;
    if (body.status === "in_progress" && !auth.task!.assigneeId) data.assigneeId = session.user.id;
  }

  if (body.takeOwnership === true) {
    data.assigneeId = session.user.id;
    if (!data.status && auth.task!.status === "open") data.status = "in_progress";
  }

  if (auth.canManage) {
    if (typeof body.title === "string" && body.title.trim()) data.title = sanitizeText(body.title).slice(0, 200);
    if (typeof body.description === "string") data.description = sanitizeText(body.description).slice(0, 5000);
    if (PRIORITIES.includes(body.priority)) data.priority = body.priority;
    if ("assigneeId" in body) data.assigneeId = body.assigneeId || null;
    if ("tags" in body) data.tags = normalizeTags(body.tags);
    if ("dueDate" in body) {
      if (body.dueDate) {
        const date = new Date(body.dueDate);
        if (!Number.isNaN(date.getTime())) data.dueDate = date;
      } else {
        data.dueDate = null;
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const task = await prisma.channelTask.update({ where: { id }, data: data as never, select: taskSelect });

  // Notify the new assignee in their Connect inbox when the task is (re)assigned
  const newAssigneeId = typeof data.assigneeId === "string" ? data.assigneeId : null;
  if (newAssigneeId && newAssigneeId !== auth.task!.assigneeId && newAssigneeId !== session.user.id) {
    await createNotification({
      userId: newAssigneeId,
      type: "task_assigned",
      title: `Вам назначена задача #${task.number}`,
      body: task.title,
      link: `/connect?group=${auth.task!.channel.groupId}&channel=${auth.task!.channelId}&task=${id}`,
    }).catch(() => null);
  }

  const mentionedUsers = await resolveMentions(task.channelId ?? auth.task!.channelId, `${task.title}\n${task.description || ""}`);
  const closedLabels: Record<string, string> = { done: "готово", failed: "провалено", needs_clarification: "требует уточнения" };
  const updateTitle = CLOSED_STATUSES.includes(task.status)
    ? `Задача #${task.number} закрыта: ${closedLabels[task.status] || task.status}`
    : `Обновление задачи #${task.number}`;
  const notificationTargets = [
    ...(task.assignee ? [task.assignee.id] : []),
    ...(task.creator ? [task.creator.id] : []),
    ...mentionedUsers.map((user) => user.id),
  ];

  await notifyUsers(
    notificationTargets,
    session.user.id,
    updateTitle,
    task.title,
    `/connect?group=${auth.task!.channel.groupId}&channel=${auth.task!.channelId}&task=${id}`,
  );

  return NextResponse.json({ task });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (await checkBan(session.user.id)) return NextResponse.json({ error: "Banned" }, { status: 403 });
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session.user.id);
  if (auth.error) return auth.error;

  const { content } = await req.json();
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Comment content required" }, { status: 400 });
  }

  const normalizedContent = sanitizeText(content).slice(0, 5000);
  const mentionedUsers = await resolveMentions(auth.task!.channelId, normalizedContent);

  const comment = await prisma.taskComment.create({
    data: {
      taskId: id,
      authorId: session.user.id,
      content: normalizedContent,
      mentions: mentionedUsers.length ? JSON.stringify(mentionedUsers.map((user) => user.id)) : null,
    },
    select: commentSelect,
  });

  await notifyUsers(
    [auth.task!.creatorId, auth.task!.assigneeId || "", ...mentionedUsers.map((user) => user.id)].filter(Boolean),
    session.user.id,
    "Новый комментарий к задаче",
    `${auth.task!.title}: ${normalizedContent.slice(0, 120)}`,
    `/connect?group=${auth.task!.channel.groupId}&channel=${auth.task!.channelId}&task=${id}`,
  );

  return NextResponse.json({ comment }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const auth = await loadAndAuthorize(id, session.user.id);
  if (auth.error) return auth.error;
  if (!auth.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const commentId = req.nextUrl.searchParams.get("commentId");
  if (commentId) {
    const comment = await prisma.taskComment.findUnique({ where: { id: commentId }, select: { authorId: true, taskId: true } });
    if (!comment || comment.taskId !== id) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    if (comment.authorId !== session.user.id && !auth.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await prisma.taskComment.delete({ where: { id: commentId } });
    return NextResponse.json({ ok: true });
  }

  await prisma.channelTask.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
