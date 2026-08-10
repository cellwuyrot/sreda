import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { checkBan } from "@/lib/banCheck";
import { sanitizeText } from "@/lib/sanitize";
import { createNotification } from "@/lib/createNotification";
import prisma from "@/lib/prisma";

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

async function getMembership(channelId: string, userId: string) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { groupId: true },
  });
  if (!channel) return null;

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: channel.groupId } },
  });

  return { channel, membership };
}

async function resolveMentions(channelId: string, text: string) {
  const usernames = Array.from(new Set(Array.from(text.matchAll(mentionRegex), (match) => match[1]?.toLowerCase()).filter(Boolean)));
  if (usernames.length === 0) return [] as { id: string; username: string; name: string }[];

  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { groupId: true } });
  if (!channel) return [];

  const groupMembers = await prisma.groupMember.findMany({
    where: {
      groupId: channel.groupId,
    },
    select: {
      user: {
        select: { id: true, username: true, name: true },
      },
    },
  });

  return groupMembers
    .map((entry) => entry.user)
    .filter((user) => usernames.includes(user.username.toLowerCase()));
}

async function notifyUsers(userIds: string[], senderId: string, senderName: string, title: string, body: string, link = "/connect") {
  await Promise.all(
    userIds
      .filter((userId, index, array) => userId !== senderId && array.indexOf(userId) === index)
      .map((userId) =>
        createNotification({
          userId,
          type: "mention",
          title,
          body: `${senderName}: ${body}`,
          link,
        }).catch(() => null),
      ),
  );

  void senderName;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const channelId = req.nextUrl.searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  const ctx = await getMembership(channelId, session.user.id);
  if (!ctx?.channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  if (!ctx.membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Return the full flat list (including subtasks) so opening a subtask's
  // detail view works from client-side state; the board itself only
  // renders top-level tasks (see the client-side `!task.parentId` filter).
  const tasks = await prisma.channelTask.findMany({
    where: { channelId },
    orderBy: [{ number: "asc" }],
    select: taskSelect,
  });

  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await rateLimit(req, `tasks:${session.user.id}`, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { channelId, title, description, priority, assigneeId, dueDate, startInProgress, tags, parentId } = await req.json();
  if (!channelId || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "channelId and title required" }, { status: 400 });
  }

  const ctx = await getMembership(channelId, session.user.id);
  if (!ctx?.channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  if (!ctx.membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (await checkBan(session.user.id)) return NextResponse.json({ error: "Banned" }, { status: 403 });

  const normalizedTitle = sanitizeText(title).slice(0, 200);
  const normalizedDescription = typeof description === "string" ? sanitizeText(description).slice(0, 5000) : "";
  const mentionUsers = await resolveMentions(channelId, `${normalizedTitle}\n${normalizedDescription}`);

  const data: Record<string, unknown> = {
    channelId,
    creatorId: session.user.id,
    title: normalizedTitle,
    description: normalizedDescription || null,
    status: startInProgress ? "in_progress" : "open",
    priority: PRIORITIES.includes(priority) ? priority : "normal",
    tags: normalizeTags(tags),
  };

  // A subtask must point at a parent task in the same channel, and can't itself
  // already be a parent chain deeper than one level (keep hierarchy flat & simple).
  if (typeof parentId === "string" && parentId) {
    const parent = await prisma.channelTask.findUnique({
      where: { id: parentId },
      select: { id: true, channelId: true, parentId: true },
    });
    if (parent && parent.channelId === channelId && !parent.parentId) {
      data.parentId = parentId;
    }
  }

  if (typeof assigneeId === "string" && assigneeId) data.assigneeId = assigneeId;
  else if (startInProgress) data.assigneeId = session.user.id;

  if (dueDate) {
    const date = new Date(dueDate);
    if (!Number.isNaN(date.getTime())) data.dueDate = date;
  }

  // Assign the next sequential number within the channel (starting from 1).
  // Retry on unique-constraint collision in case of concurrent creation.
  let task;
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.channelTask.findFirst({
      where: { channelId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    try {
      task = await prisma.channelTask.create({
        data: { ...data, number: (last?.number ?? 0) + 1 } as never,
        select: taskSelect,
      });
      break;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  if (!task) return NextResponse.json({ error: "Failed to create task" }, { status: 500 });

  const senderName = session.user.name || session.user.username || "Пользователь";

  // Notify the assignee in their Connect inbox
  if (task.assignee && task.assignee.id !== session.user.id) {
    await createNotification({
      userId: task.assignee.id,
      type: "task_assigned",
      title: `Вам назначена задача #${task.number}`,
      body: `${senderName}: ${normalizedTitle}`,
      link: `/connect?group=${ctx.channel.groupId}&channel=${channelId}&task=${task.id}`,
    }).catch(() => null);
  }

  await notifyUsers(
    mentionUsers.map((user) => user.id),
    session.user.id,
    senderName,
    "Новая задача",
    `#${task.number} ${normalizedTitle}`,
    `/connect?group=${ctx.channel.groupId}&channel=${channelId}&task=${task.id}`,
  );

  return NextResponse.json({ task });
}
