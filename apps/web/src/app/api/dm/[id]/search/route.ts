import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await rateLimit(req, "dm-search", { limit: 40, windowMs: 60000 }); if (limited) return limited;
  const { id } = await params;
  const conv = await prisma.directConversation.findUnique({ where: { id } });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (conv.user1Id !== session.user.id && conv.user2Id !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (conv.kind !== "PERSONAL") return NextResponse.json({ error: "Серверный поиск недоступен для этого вида переписки" }, { status: 400 });
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  if (q.length < 2 || q.length > 200) return NextResponse.json({ error: "Введите от 2 до 200 символов" }, { status: 400 });
  const cursor = req.nextUrl.searchParams.get("cursor");
  if (cursor && !await prisma.directMessage.findFirst({ where: { id: cursor, conversationId: id, deleted: false, encrypted: false } })) return NextResponse.json({ error: "Некорректный курсор" }, { status: 400 });
  const rows = await prisma.directMessage.findMany({ where: { conversationId: id, deleted: false, encrypted: false, content: { contains: q, mode: "insensitive" } },
    select: { id: true, content: true, createdAt: true, user: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 31, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return NextResponse.json({ items: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29].id : null });
}
