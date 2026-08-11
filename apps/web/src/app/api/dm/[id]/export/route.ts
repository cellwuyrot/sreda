import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isStaffRole } from "@/lib/businessChat";

/**
 * ARCHIVE: выгрузка переписки одним файлом — GET /api/dm/<id>/export
 *
 * Архив в проекте означает копию на устройстве человека, а не ещё один
 * список на сервере. Поэтому здесь собирается всё, что потребуется для чтения
 * переписки без доступа к сайту: участники, тексты, времена, ответы и описи
 * вложений.
 *
 * Чего выгрузка НЕ делает:
 *
 *   • не кладёт внутрь сами файлы — только адреса, имена и размеры. Переписка
 *     с годовым запасом видео весит гигабайты, и один запрос такого
 *     размера просто не дойдёт;
 *   • не расшифровывает сквозное шифрование. Сообщения с признаком e2ee уходят
 *     шифротекстом: ключа у сервера нет и быть не должно.
 *
 * Кто может выгружать: участник переписки, а в деловом разговоре — ещё и
 * администрация, ровно как в остальных маршрутах этого раздела: очередь
 * заявок общая.
 */

/** Вложение в выгрузке: опись, а не сам файл. */
interface ExportedAttachment {
  url: string;
  name: string;
  size: number | null;
  type: string | null;
}

function describeAttachments(raw: string | null): ExportedAttachment[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 50).map((item) => {
      const a = (item ?? {}) as Record<string, unknown>;
      const size = Number(a.size);
      return {
        url: typeof a.url === "string" ? a.url : "",
        name: typeof a.name === "string" ? a.name : "",
        size: Number.isFinite(size) ? size : null,
        type: typeof a.type === "string" ? a.type : null,
      };
    });
  } catch {
    /* битый JSON у старого сообщения не должен ронять выгрузку целиком */
    return [];
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;

  const conversation = await prisma.directConversation.findUnique({
    where: { id },
    include: {
      user1: { select: { id: true, name: true, username: true } },
      user2: { select: { id: true, name: true, username: true } },
    },
  });
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const participant = conversation.user1Id === userId || conversation.user2Id === userId;
  const business = conversation.kind === "BUSINESS";
  if (!participant && !(business && isStaffRole(session.user.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /* Вся переписка от старых сообщений к новым — читать выгрузку будут сверху
     вниз, как обычный текст. Предел в десять тысяч сообщений защищает память
     сервера: выгрузка собирается целиком в памяти, без потоковой отдачи. */
  const LIMIT = 10_000;
  const messages = await prisma.directMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
    include: {
      user: { select: { id: true, name: true, username: true } },
      replyTo: { select: { id: true, content: true, user: { select: { name: true } } } },
    },
  });

  const exported = messages.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    edited: m.edited,
    deleted: m.deleted,
    pinned: m.pinned,
    /* Удалённое сообщение остаётся строкой без текста: без него в выгрузке
       рвётся цепочка ответов и непонятно, на что отвечали. */
    author: { id: m.user.id, name: m.user.name, username: m.user.username },
    text: m.deleted ? "" : m.content,
    encrypted: m.encrypted,
    replyTo: m.replyTo
      ? { id: m.replyTo.id, author: m.replyTo.user.name, text: m.replyTo.content }
      : null,
    attachments: describeAttachments(m.attachments),
  }));

  return NextResponse.json({
    format: "trioz-chat-archive",
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: { id: userId, name: session.user.name ?? "" },
    conversation: {
      id: conversation.id,
      kind: conversation.kind,
      createdAt: conversation.createdAt,
      lastMessageAt: conversation.lastMessageAt,
      appealId: conversation.appealId,
      participants: [conversation.user1, conversation.user2],
    },
    messageCount: exported.length,
    /* Честно говорим, что выгрузка оборвана: молчаливо отданный кусок
       человек примет за полную копию и спокойно удалит переписку. */
    truncated: exported.length >= LIMIT,
    messages: exported,
  });
}
