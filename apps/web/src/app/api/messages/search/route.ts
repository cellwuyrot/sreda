import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getChannelPermissions } from "@/lib/connectPermissions";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channelId");
  const q = searchParams.get("q");
  if (!channelId || !q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { groupId: true },
  });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const permission = await getChannelPermissions(session.user.id, channelId);
  if (!permission?.canView) return NextResponse.json({ error: permission?.denialReason ?? "Forbidden" }, { status: 403 });

  const messages = await prisma.message.findMany({
    where: {
      channelId,
      deleted: false,
      content: { contains: q.trim() },
    },
    include: {
      user: { select: { id: true, name: true, username: true, avatar: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json(messages);
}
