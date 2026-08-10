import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { hasPremium } from "@/lib/premium";
import { FREE_SCHEDULED_QUEUE, scheduledQueueLimit } from "@/lib/premiumLimits";
import { checkBan } from "@/lib/banCheck";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const msgs = await prisma.scheduledMessage.findMany({
    where: { userId: session.user.id, sent: false },
    orderBy: { scheduledAt: "asc" },
    include: { channel: { select: { id: true, name: true } } },
  });

  return NextResponse.json(msgs);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать создавать отложенные сообщения в каналах.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { content, channelId, scheduledAt } = await req.json();
  if (!content?.trim() || !channelId || !scheduledAt) {
    return NextResponse.json({ error: "content, channelId, scheduledAt required" }, { status: 400 });
  }

  // FIX-SEC-IDOR: планировать сообщение можно только в канал, куда есть право
  // писать (раньше проверялась лишь сессия — можно было отложить пост в любой канал).
  const perm = await getChannelPermissions(session.user.id, channelId);
  if (!perm?.canPost) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const schedDate = new Date(scheduledAt);
  if (schedDate.getTime() <= Date.now()) {
    return NextResponse.json({ error: "scheduledAt must be in the future" }, { status: 400 });
  }

  /* Очередь отложенных ограничена без подписки: возможность полезная, но
     бесплатный аккаунт не должен превращать её в рассыльщик. */
  const queueLimit = scheduledQueueLimit(hasPremium(session.user));
  if (queueLimit !== null) {
    const pending = await prisma.scheduledMessage.count({
      where: { userId: session.user.id, sent: false },
    });
    if (pending >= queueLimit) {
      return NextResponse.json(
        {
          error: `В очереди уже ${pending} из ${FREE_SCHEDULED_QUEUE} отложенных сообщений. С подпиской Premium очередь не ограничена.`,
        },
        { status: 403 },
      );
    }
  }

  const msg = await prisma.scheduledMessage.create({
    data: { content: content.trim().slice(0, 4000), channelId, userId: session.user.id, scheduledAt: schedDate },
  });

  return NextResponse.json(msg, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать удалять отложенные сообщения.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const msg = await prisma.scheduledMessage.findUnique({ where: { id } });
  if (!msg || msg.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.scheduledMessage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
