import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
// GET /api/wiki/[id]/revisions
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const article = await prisma.wikiArticle.findUnique({
    where: { id },
    include: { channel: { select: { groupId: true } } },
  });
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: article.channel.groupId } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const revisions = await prisma.wikiRevision.findMany({
    where: { articleId: id },
    select: { id: true, content: true, createdAt: true,
      editor: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ revisions });
}
