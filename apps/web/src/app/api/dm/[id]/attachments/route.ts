import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const conv = await prisma.directConversation.findUnique({ where: { id } });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (conv.user1Id !== session.user.id && conv.user2Id !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (conv.kind === "SECURE") return NextResponse.json({ error: "Материалы защищённой переписки пока недоступны" }, { status: 400 });
  const links = req.nextUrl.searchParams.get("type") === "links";
  const cursor = req.nextUrl.searchParams.get("cursor");
  if (cursor && !await prisma.directMessage.findFirst({ where: { id: cursor, conversationId: id } })) return NextResponse.json({ error: "Некорректный курсор" }, { status: 400 });
  const rows = await prisma.directMessage.findMany({
    where: { conversationId: id, deleted: false, encrypted: false, ...(links ? { content: { contains: "http", mode: "insensitive" as const } } : { NOT: { attachments: null } }) },
    select: { id: true, content: true, attachments: true, createdAt: true, user: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const items: Record<string, unknown>[] = [];
  for (const m of rows.slice(0, 50)) {
    const base = { messageId: m.id, userName: m.user.name || "Участник", createdAt: m.createdAt.toISOString() };
    if (links) {
      const urls = Array.from(new Set(m.content.match(/https?:\/\/[^\s<>"`]+/gi) || []));
      for (const url of urls) { try { const parsed = new URL(url); if (["http:", "https:"].includes(parsed.protocol)) items.push({ ...base, url, name: parsed.hostname, isLink: true }); } catch { /* malformed */ } }
    } else {
      try {
        const raw: unknown = JSON.parse(m.attachments || "[]");
        if (!Array.isArray(raw)) continue;
        for (const a of raw) {
          if (!a || typeof a !== "object" || typeof a.url !== "string" || !a.url.startsWith("/uploads/")) continue;
          // Preserve encryption metadata for legacy records; UI must never preview ciphertext as media.
          items.push({ ...base, url: a.url, name: typeof a.name === "string" ? a.name : "Файл", size: typeof a.size === "number" ? a.size : 0,
            isImage: a.isImage === true, isVideo: a.isVideo === true || a.isVideoNote === true, isVoice: a.isVoice === true,
            isE2EE: a.isE2EE === true, e2eeIv: typeof a.e2eeIv === "string" ? a.e2eeIv : undefined });
        }
      } catch { /* malformed legacy attachments */ }
    }
  }
  return NextResponse.json({ items, nextCursor: rows.length > 50 ? rows[49].id : null });
}
