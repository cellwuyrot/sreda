import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getIO } from "@/lib/socketEmit";
import { getChannelPermissions } from "@/lib/connectPermissions";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { messageIds, channelId } = await req.json();
  const ids0: string[] = Array.isArray(messageIds) ? messageIds : [];

  /* FIX-NEWS-READ: раньше отметка прочтения требовала списка сообщений. В переписке
     это естественно: видны конкретные строки, и галочки ставятся именно им. А в
     новостях читается раздел целиком и галочек нет вовсе — ленте нужно только
     продвинуть lastRead, чтобы погас счётчик. Поэтому допускается вызов с одним
     channelId. Права проверяются ниже точно так же, что и раньше (FIX-SEC-IDOR). */
  if (ids0.length === 0 && !channelId) {
    return NextResponse.json({ error: "messageIds or channelId required" }, { status: 400 });
  }

  const userId = (session.user as { id: string }).id;

  // FIX-SEC-IDOR: раньше можно было продвигать lastRead и рассылать
  // "messages-read" в ЛЮБОМ канале по произвольному channelId. Теперь, если
  // channelId передан, требуется доступ к этому каналу.
  if (channelId) {
    const perm = await getChannelPermissions(userId, channelId);
    if (!perm?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ids = ids0.slice(0, 100);
  await Promise.all(
    ids.map((messageId: string) =>
      prisma.messageRead.upsert({
        where: { userId_messageId: { userId, messageId } },
        update: {},
        create: { userId, messageId },
      }).catch(() => {})
    )
  );

  // NEW: продвигаем lastRead участника канала — именно от него
  // /api/channels/unread считает непрочитанные, из которых складывается
  // цифра на значке приложения в десктопе.
  if (channelId) {
    await prisma.channelMember.upsert({
      where: { userId_channelId: { userId, channelId } },
      update: { lastRead: new Date() },
      create: { userId, channelId, lastRead: new Date() },
    }).catch(() => {});
  }

  const io = getIO();
  if (io && channelId) {
    io.to(`channel-${channelId}`).emit("messages-read", { userId, messageIds: ids });
  }

  return NextResponse.json({ ok: true });
}
