import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// Statuses that still need work — a closed task has nothing left to execute,
// so it never gets offered for transfer into the personal workspace.
const OPEN_STATUSES = ["open", "in_progress"];

const taskSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  tags: true,
  parentId: true,
  channelId: true,
  channel: {
    select: {
      id: true,
      name: true,
      groupId: true,
      group: { select: { id: true, name: true } },
    },
  },
  checklist: {
    select: { id: true, text: true, done: true, order: true },
    orderBy: { order: "asc" },
  },
} as const;

/**
 * GET /api/tasks/assigned
 *
 * Returns the open tasks that are assigned to the current user (the "связь по
 * нику" — the person who does the task), across every group they still belong
 * to. The personal "Рабочая среда" canvas uses this to let a user pull their
 * assigned tasks in for execution.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  // Groups the user is currently a member of. Assignments in groups they have
  // since left must not leak into their workspace.
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const groupIds = new Set(memberships.map((m) => m.groupId));
  if (groupIds.size === 0) return NextResponse.json({ tasks: [] });

  const rows = await prisma.channelTask.findMany({
    where: {
      assigneeId: userId,
      status: { in: OPEN_STATUSES },
      channel: { groupId: { in: Array.from(groupIds) } },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: taskSelect,
  });

  const tasks = rows.map((task) => ({
    id: task.id,
    number: task.number,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    tags: task.tags,
    parentId: task.parentId,
    channelId: task.channelId,
    channelName: task.channel?.name ?? "",
    groupId: task.channel?.groupId ?? "",
    groupName: task.channel?.group?.name ?? "",
    checklist: task.checklist.map((item) => ({
      id: item.id,
      text: item.text,
      done: item.done,
      order: item.order,
    })),
  }));

  return NextResponse.json({ tasks });
}
