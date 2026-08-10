import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ROLE_RANK } from "@/lib/groupModeration";

// NEW: журнал аудита группы. Доступен модераторам и выше.
// GET /api/groups/{id}/audit?limit=100&before=<ISO date>

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  if (!membership || (ROLE_RANK[membership.role] ?? 0) < ROLE_RANK.MODERATOR) {
    return NextResponse.json({ error: "Only moderators can view the audit log" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 100;
  const before = url.searchParams.get("before");

  const entries = await prisma.groupAuditEntry.findMany({
    where: {
      groupId: id,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ entries, hasMore: entries.length === limit });
}
