import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { unlink } from "fs/promises";
import prisma from "@/lib/prisma";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { resolveUploadPath } from "@/lib/uploadPaths";
import { checkBan } from "@/lib/banCheck";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать удалять файлы из каналов группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const file = await prisma.workspaceFile.findUnique({
    where: { id },
    select: { id: true, url: true, uploaderId: true, channelId: true },
  });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* FIX-SEC-ACL: право считалось по роли в сообществе, а не по каналу. Модератор
     сообщества мог удалить документ из канала, который ему не виден, — а автор
     файла и вовсе проходил без единой проверки канала. */
  const permissions = await getChannelPermissions(session.user.id, file.channelId);
  if (!permissions?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const canManage = permissions.canModerate || session.user.role === "ADMIN" || file.uploaderId === session.user.id;
  if (!canManage) return NextResponse.json({ error: "No permission" }, { status: 403 });

  await prisma.workspaceFile.delete({ where: { id } });
  try {
    /* Путь на диске считает общий разборщик: он же знает, что документы лежат
       вне public/, и он же не пускает за пределы каталога загрузок, даже если
       адрес в базе подделан. */
    const resolved = resolveUploadPath(file.url);
    if (resolved) await unlink(resolved.filePath);
  } catch {}
  return NextResponse.json({ ok: true });
}
