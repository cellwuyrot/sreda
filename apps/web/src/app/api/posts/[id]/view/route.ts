import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { loadPostForViewer } from "@/lib/newsPost";

/**
 * NEWSPOST: «этот пост прочитали».
 *
 * ── Почему просмотр не просто +1 ────────────────────────────────────────────
 *
 * Счётчик, который растёт на каждый запрос, не показывает ничего: обновил
 * страницу трижды — «три просмотра». Поэтому просмотр — это строка PostView, а
 * число на посте лишь повторяет их количество, чтобы лента не считала COUNT(*)
 * на каждую карточку.
 *
 * Уникальность пары (пост, человек) стоит в базе, а не в проверке «нет ли уже»:
 * две вкладки, открытые одновременно, проходят такую проверку обе. skipDuplicates
 * превращает гонку в обычный ноль вставленных строк — и счётчик не растёт.
 *
 * Свой пост просмотров не добавляет: автор открывает его чаще всех, и без
 * этого правила у каждой новости было бы «просмотров: 1» сразу после
 * публикации, а у активного автора — и десяток.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await loadPostForViewer(id, session.user.id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { post } = access;
  if (post.userId === session.user.id) {
    return NextResponse.json({ views: post.views });
  }

  const inserted = await prisma.postView.createMany({
    data: [{ messageId: post.id, userId: session.user.id }],
    skipDuplicates: true,
  });
  /* Уже смотрел — ничего не меняем и отдаём текущее число: клиенту всё равно
     нужно чем-то обновить подпись под постом. */
  if (inserted.count === 0) return NextResponse.json({ views: post.views });

  /* increment, а не «прочитать и записать»: два одновременных первых просмотра
     прочитали бы одно и то же число и записали бы одно и то же. */
  const updated = await prisma.message.update({
    where: { id: post.id },
    data: { views: { increment: 1 } },
    select: { views: true },
  });

  return NextResponse.json({ views: updated.views });
}
