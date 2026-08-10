import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { emitToGroup } from "@/lib/socketEmit";
import { resolveUploadPath } from "@/lib/uploadPaths";
import { unlink } from "fs/promises";

// DELETE /api/groups/[id]/emoji/[emojiId] — убрать эмодзи из набора сообщества.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; emojiId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — иначе забаненный с живым токеном
  // мог бы вычистить набор сообщества.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id, emojiId } = await params;

  /* Право то же, что и на добавление: создатель или админ сообщества. Автор
     загрузки сам по себе права не даёт — набор общий, а не личный. */
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
    select: { role: true },
  });
  if (membership?.role !== "OWNER" && membership?.role !== "ADMIN") {
    return NextResponse.json({ error: "Удалять эмодзи может создатель или админ сообщества" }, { status: 403 });
  }

  /* Ищем по паре id + groupId: адрес сообщества в ссылке брать на веру нельзя,
     иначе админ одного сообщества удалял бы эмодзи чужого по прямому запросу. */
  const emoji = await prisma.groupEmoji.findFirst({
    where: { id: emojiId, groupId: id },
    select: { id: true, url: true },
  });
  if (!emoji) return NextResponse.json({ error: "Эмодзи не найден" }, { status: 404 });

  await prisma.groupEmoji.delete({ where: { id: emoji.id } });

  try {
    /* Путь на диске считает общий разборщик: он же не пускает за пределы
       каталога загрузок, даже если адрес в базе подделан. */
    const resolved = resolveUploadPath(emoji.url);
    if (resolved) await unlink(resolved.filePath);
  } catch {
    /* Файла уже нет — строку мы всё равно убрали, показывать ошибку незачем. */
  }

  // Удалённый эмодзи должен исчезнуть у всех, кто держит сообщество открытым.
  emitToGroup(id, "group-emoji-updated", { groupId: id });

  return NextResponse.json({ ok: true });
}
