import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// FIX-DM: все вложения и материалы диалога — для пункта меню
// «Вложения и материалы чата».

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;

  const conversation = await prisma.directConversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (conversation.user1Id !== userId && conversation.user2Id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = await prisma.directMessage.findMany({
    where: { conversationId: id, deleted: false, NOT: { attachments: null } },
    select: {
      id: true,
      attachments: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  type Item = {
    messageId: string;
    userName: string;
    createdAt: string;
    url: string;
    name?: string;
    isImage?: boolean;
    isVideo?: boolean;
    isVoice?: boolean;
  };

  const items: Item[] = [];
  for (const m of messages) {
    if (!m.attachments) continue;
    try {
      const parsed: unknown = JSON.parse(m.attachments);
      if (!Array.isArray(parsed)) continue;
      for (const a of parsed) {
        if (!a || typeof a !== "object") continue;
        const att = a as { url?: unknown; name?: unknown; isImage?: unknown; isVideo?: unknown; isVoice?: unknown };
        if (typeof att.url !== "string") continue;
        items.push({
          messageId: m.id,
          userName: m.user.name ?? "Участник",
          createdAt: m.createdAt.toISOString(),
          url: att.url,
          name: typeof att.name === "string" ? att.name : undefined,
          isImage: att.isImage === true,
          isVideo: att.isVideo === true,
          isVoice: att.isVoice === true,
        });
      }
    } catch { /* битый JSON — пропускаем */ }
  }

  return NextResponse.json({ items });
}
