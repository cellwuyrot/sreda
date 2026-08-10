import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { hasPremium } from "@/lib/premium";
import { logGroupAction } from "@/lib/groupAudit";
import {
  CENSOR_DICTIONARY_MAX,
  isCensorLevel,
  normalizeCensorWordInput,
  type CensorLevel,
} from "@/lib/censor";
import { censorCounters, invalidateCensorCache } from "@/lib/censorService";

/**
 * Словарь цензуры сообщества и сводка наблюдений.
 *
 * Право на раздел — подписка у ВЛАДЕЛЬЦА сообщества: платит за возможности
 * места тот, кто его создал. Правит словарь владелец или администратор
 * сообщества; модератор — нет: это не мера модерации, а правило места.
 *
 * Сводку наблюдений видят те же, кто правит словарь. Показывать её модератору
 * было бы логично, но счётчик — это досье на человека, и круг тех, кто его
 * видит, лучше держать узким, пока не попросят обратного.
 */

async function censorAccess(userId: string, groupId: string) {
  const [group, membership] = await Promise.all([
    prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, owner: { select: { isPremium: true, role: true } } },
    }),
    prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      select: { role: true },
    }),
  ]);
  if (!group) return null;
  return {
    canManage: membership?.role === "OWNER" || membership?.role === "ADMIN",
    ownerPremium: hasPremium(group.owner),
  };
}

/** GET — словарь и сводка. Оба списка нужны одному экрану, поэтому один запрос. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await censorAccess(session.user.id, id);
  if (!access) return NextResponse.json({ error: "Сообщество не найдено" }, { status: 404 });
  if (!access.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  /* Без подписки отдаём пустой раздел, а не отказ: экран должен объяснить, что
     возможность платная, а не выглядеть поломкой. */
  if (!access.ownerPremium) {
    return NextResponse.json({ available: false, words: [], counters: [], limit: CENSOR_DICTIONARY_MAX });
  }

  const [words, counters] = await Promise.all([
    prisma.groupCensorWord.findMany({
      where: { groupId: id },
      select: { id: true, word: true, level: true, createdAt: true },
      orderBy: [{ level: "asc" }, { word: "asc" }],
    }),
    censorCounters(id),
  ]);

  return NextResponse.json({ available: true, words, counters, limit: CENSOR_DICTIONARY_MAX });
}

/** POST — добавить слово. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const access = await censorAccess(session.user.id, id);
  if (!access) return NextResponse.json({ error: "Сообщество не найдено" }, { status: 404 });
  if (!access.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!access.ownerPremium) {
    return NextResponse.json({ error: "Раздел цензуры доступен сообществам с Premium у владельца" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = normalizeCensorWordInput(body?.word);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const level: CensorLevel = isCensorLevel(body?.level) ? body.level : "WATCH";

  /* Предел на размер словаря — не жадность, а стоимость: разбор идёт на каждое
     сообщение, и словарь в тысячу записей заметно удорожает отправку. */
  const count = await prisma.groupCensorWord.count({ where: { groupId: id } });
  if (count >= CENSOR_DICTIONARY_MAX) {
    return NextResponse.json({ error: `В словаре уже ${CENSOR_DICTIONARY_MAX} записей — предел` }, { status: 400 });
  }

  const existing = await prisma.groupCensorWord.findFirst({
    where: { groupId: id, word: parsed.word },
    select: { id: true, level: true },
  });

  /* Повторное добавление того же слова — это смена уровня, а не ошибка: так
     человек и думает, когда переносит слово из наблюдения в запрет. */
  const saved = existing
    ? await prisma.groupCensorWord.update({
        where: { id: existing.id },
        data: { level },
        select: { id: true, word: true, level: true, createdAt: true },
      })
    : await prisma.groupCensorWord.create({
        data: { groupId: id, word: parsed.word, level, createdById: session.user.id },
        select: { id: true, word: true, level: true, createdAt: true },
      });

  invalidateCensorCache(id);
  await logGroupAction({
    groupId: id,
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.username ?? "—",
    action: existing ? "censor.level" : "censor.add",
    details: `«${parsed.word}» → ${level}`,
  });

  return NextResponse.json({ word: saved, replaced: !!existing });
}

/** DELETE — убрать слово. Наблюдения по нему остаются: это история, не словарь. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await censorAccess(session.user.id, id);
  if (!access) return NextResponse.json({ error: "Сообщество не найдено" }, { status: 404 });
  if (!access.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const wordId = searchParams.get("wordId");
  if (!wordId) return NextResponse.json({ error: "wordId обязателен" }, { status: 400 });

  const row = await prisma.groupCensorWord.findFirst({
    where: { id: wordId, groupId: id },
    select: { id: true, word: true },
  });
  if (!row) return NextResponse.json({ error: "Слово не найдено" }, { status: 404 });

  await prisma.groupCensorWord.delete({ where: { id: row.id } });
  invalidateCensorCache(id);
  await logGroupAction({
    groupId: id,
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.username ?? "—",
    action: "censor.remove",
    details: `«${row.word}»`,
  });

  return NextResponse.json({ success: true });
}
