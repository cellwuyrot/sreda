import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";

/**
 * Leave a community the current user joined.
 *
 * Any member can leave except:
 * - the owner (must delete the group or transfer ownership first), and
 * - members of the main community (which everyone belongs to by design).
 *
 * The client refreshes its group list after a successful leave, mirroring how
 * the rest of the group routes work.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }
  if (group.isMain) {
    return NextResponse.json({ error: "Нельзя покинуть основное сообщество" }, { status: 403 });
  }
  if (membership.role === "OWNER") {
    return NextResponse.json(
      { error: "Владелец не может покинуть группу — передайте владение или удалите её" },
      { status: 403 },
    );
  }

  await prisma.groupMember.delete({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "user",
    action: "leave",
    target: "Group",
    targetId: id,
    details: `Выход из группы "${group.name}"`,
  });

  return NextResponse.json({ ok: true });
}
