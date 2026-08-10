import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { presenceSince } from "@/lib/onlinePresence";

/**
 * GET /api/groups/[id]/presence — кто из участников сообщества в сети прямо сейчас.
 *
 * ── Зачем отдельный маршрут ─────────────────────────────────────────────────
 *
 * Список участников приходит со снимком сообщества, и отметки присутствия в нём
 * замирают на момент открытия группы: снимок больше не перезапрашивается. Раньше
 * при открытом списке участников снимок обновлялся целиком — вместе с каналами,
 * разделами и модулями, — и от этого отказались как от дорогого, потеряв заодно
 * живое присутствие.
 *
 * Присутствие — данные частые и крошечные, поэтому у них свой запрос. Он отдаёт
 * ТОЛЬКО идентификаторы присутствующих: размер ответа ограничен числом людей в
 * сети, а не размером сообщества. Кого в ответе нет, тот гаснет сам — его
 * `lastSeen` устареет на клиенте.
 *
 * Право то же, что у списка участников: видит любой участник группы. `checkBan`
 * не нужен — маршрут только читает.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  const now = new Date();
  /* `showOnline: false` — человек скрыл присутствие. Его отметку не обновляет и
     сам удар сети (см. api/heartbeat), так что фильтр здесь — подстраховка и
     заявление о намерении: скрывший присутствие не должен попадать в список
     даже при случайно обновившейся отметке. */
  const rows = await prisma.groupMember.findMany({
    where: {
      groupId: id,
      user: { showOnline: true, lastSeen: { gte: presenceSince(now.getTime()) } },
    },
    select: { userId: true },
  });

  return NextResponse.json(
    {
      online: rows.map((row: { userId: string }) => row.userId),
      at: now.toISOString(),
    },
    /* Ответ живёт секунды и запрашивается часто — кэшировать его нельзя ни
       браузеру, ни прокси: иначе присутствие снова «замрёт», только уже в кэше. */
    { headers: { "Cache-Control": "no-store" } },
  );
}
