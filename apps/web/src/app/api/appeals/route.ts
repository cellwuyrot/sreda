import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ensureAppealsChannel } from "@/lib/mainCommunity";
import { notifyNewAppeal } from "@/lib/appealNotify";
import { checkAppealLimits } from "@/lib/appealLimits";
import { ensureBusinessChat, isBusinessAppeal } from "@/lib/businessChat";

const BAN_APPEAL_LIMIT = 2;
const BAN_APPEAL_PREFIX = "BAN_APPEAL:";

async function getBanAppealStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { banned: true },
  });
  if (!user?.banned) {
    return { allowed: false, used: 0, remaining: 0, limit: BAN_APPEAL_LIMIT, category: null as string | null };
  }

  // A ban audit row's createdAt is refreshed when logAction de-duplicates a
  // rapid re-ban. Including both id and timestamp therefore produces a fresh
  // cycle token after unban → ban without deleting the previous appeal history.
  const latestBan = await prisma.auditLog.findFirst({
    where: { action: "ban", target: "User", targetId: userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  const cycle = latestBan
    ? `${latestBan.id}:${latestBan.createdAt.getTime()}`
    : `legacy:${userId}`;
  const category = `${BAN_APPEAL_PREFIX}${cycle}`;
  const used = await prisma.appeal.count({ where: { authorId: userId, category } });
  return {
    allowed: used < BAN_APPEAL_LIMIT,
    used,
    remaining: Math.max(0, BAN_APPEAL_LIMIT - used),
    limit: BAN_APPEAL_LIMIT,
    category,
  };
}

async function findAppealsChannel(channelId?: string) {
  if (channelId) {
    return prisma.channel.findFirst({ where: { id: channelId, type: "APPEALS" } });
  }
  // Global envelope submissions are routed to the main TZ Connect appeals
  // channel. Keep a fallback for installations created before isMain existed.
  return (await prisma.channel.findFirst({
    where: { type: "APPEALS", group: { isMain: true } },
    orderBy: { createdAt: "asc" },
  })) ?? prisma.channel.findFirst({
    where: { type: "APPEALS" },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Канал, в который падают обращения. Досоздаёт его, если такого канала нет.
 *
 * Раньше отсутствие канала было тупиком: главное сообщество создаётся набором
 * из «Общего», «Объявлений» и четырёх голосовых — канала обращений среди них не
 * было. То есть на любой установке форма обращений и заявка на сотрудничество
 * гарантированно отвечали «раздел не настроен», пока кто-нибудь не добавил бы
 * канал руками. Виноват в этом не тот, кто «не заполнил»: интерфейс предлагал
 * отправить обращение, а принимать его было некуда.
 *
 * Досоздание здесь, а не только при создании сообщества: на работающих
 * установках сообщество давно создано, и набор каналов к нему уже не
 * применяется. Действие идемпотентное — сначала ищем, создаём только если нет.
 * Явно указанный channelId не досоздаём: там просят конкретный канал, и
 * подменять его другим неправильно.
 */
async function resolveAppealsChannel(channelId?: string) {
  const found = await findAppealsChannel(channelId);
  if (found || channelId) return found;
  await ensureAppealsChannel();
  return findAppealsChannel();
}

// GET /api/appeals?channelId=...&scope=admin
// - scope=admin (ADMIN only): all appeals (optionally for one channel)
// - default: only the current user's own appeals
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channelId") || undefined;
  const scope = searchParams.get("scope");
  const status = searchParams.get("status") || undefined;

  if (searchParams.get("banStatus") === "1") {
    const banAppeal = await getBanAppealStatus(session.user.id);
    return NextResponse.json({ banAppeal: { ...banAppeal, category: undefined } });
  }

  const isAdmin = (session.user.role === "ADMIN" || session.user.role === "EDITOR");
  const adminScope = scope === "admin" && isAdmin;

  const where: Record<string, unknown> = {};
  if (channelId) where.channelId = channelId;
  if (status) where.status = status;
  if (!adminScope) where.authorId = session.user.id;

  const appeals = await prisma.appeal.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      author: { select: { id: true, name: true, username: true, avatar: true } },
      channel: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({ appeals, isAdmin });
}

// POST /api/appeals  { channelId, subject, body, category? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await req.json();
  const requestedChannelId = (data.channelId || "").trim();
  const subject = (data.subject || "").trim();
  const body = (data.body || "").trim();
  const requestedCategory = (data.category || "").trim();
  /* FIX-SRVDOC: услуга из кнопки «Сотрудничество»: по ней в деловой чат
     подкладываются приложенные документы. Не пришла — заявка принимается как раньше. */
  const serviceId = typeof data.serviceId === "string" ? data.serviceId.trim() : "";
  const isBanAppeal = requestedCategory === "BAN_APPEAL";

  if (!subject || !body) {
    return NextResponse.json({ error: "Тема и текст обращения обязательны" }, { status: 400 });
  }
  if (subject.length > 120 || body.length > 4000) {
    return NextResponse.json({ error: "Обращение слишком длинное" }, { status: 400 });
  }

  let banAppeal = null as Awaited<ReturnType<typeof getBanAppealStatus>> | null;
  let category = requestedCategory;
  if (isBanAppeal) {
    banAppeal = await getBanAppealStatus(session.user.id);
    if (!banAppeal.category) {
      return NextResponse.json({ error: "Учётная запись не заблокирована", banAppeal }, { status: 403 });
    }
    if (!banAppeal.allowed) {
      return NextResponse.json({ error: "Лимит обжалований для этого бана исчерпан", banAppeal }, { status: 429 });
    }
    category = banAppeal.category;
  }

  /* ANTISPAM: пауза, предел незакрытых и запрет дубля. Проверяем до поиска
     канала — незачем ходить в базу за каналом, если отправлять всё равно
     нельзя. Обжалование блокировки этих правил не касается: у него свой предел
     выше, и наказывать за него дважды неправильно. */
  if (!isBanAppeal) {
    const limits = await checkAppealLimits({ userId: session.user.id, subject, body });
    if (limits.error) {
      const headers: Record<string, string> = {};
      if (limits.retryAfterSec) headers["Retry-After"] = String(limits.retryAfterSec);
      return NextResponse.json(
        { error: limits.error, retryAfterSec: limits.retryAfterSec },
        { status: 429, headers },
      );
    }
  }

  const channel = await resolveAppealsChannel(requestedChannelId || undefined);
  if (!channel) {
    /* Сюда попадаем, только если досоздать канал не удалось: главного
       сообщества нет вовсе или база недоступна. Отправителю про устройство
       установки знать нечего — ему нужно понять, что делать дальше. */
    return NextResponse.json(
      { error: "Приём обращений сейчас недоступен. Сообщите администратору сообщества — раздел обращений не создан." },
      { status: 503 },
    );
  }

  const appeal = await prisma.appeal.create({
    data: {
      channelId: channel.id,
      authorId: session.user.id,
      subject,
      body,
      category,
      status: "OPEN",
      messages: {
        create: { authorId: session.user.id, body, isAdmin: false },
      },
    },
    include: {
      author: { select: { id: true, name: true, username: true, avatar: true } },
      _count: { select: { messages: true } },
    },
  });

  /* CHAT: заявка на сотрудничество получает чат СРАЗУ при подаче, а не после
     первого ответа. Человек только что описал задачу и пойдёт искать разговор
     там, где ему его обещали, — а не найдя, отправит заявку заново. Каждое новое
     обращение даёт свой чат: это разные разговоры о разных задачах.

     Со стороны администрации это один общий список: доступ даёт роль, а ведущего
     назначает первый ответ (см. lib/businessChat).

     Ошибку глотаем с записью в журнал: обращение уже принято, и ронять приём
     из-за чата нельзя — человек решит, что заявка не ушла, и отправит снова. */
  if (isBusinessAppeal(category)) {
    try {
      await ensureBusinessChat({
        appealId: appeal.id,
        clientId: session.user.id,
        subject,
        appealBody: body,
        serviceId: serviceId || null,
      });
    } catch (err) {
      console.warn("[appeals] не удалось открыть деловой чат по новой заявке", appeal.id, err);
    }
  }

  /* Сообщаем всем, кто разбирает обращения. Раньше здесь были только роли
     ADMIN, хотя разбирать их может и EDITOR — оба под-маршрута обращения
     считают его администратором. Редакторы не знали о работе, которую им
     поручено делать. Рассылка одной пачкой: два запроса вместо двух на каждого
     получателя (см. lib/createNotification). */
  await notifyNewAppeal({
    appealId: appeal.id,
    actorId: session.user.id,
    authorName: appeal.author.name,
    subject,
    isBanAppeal,
    body,
  });

  const nextBanAppeal = isBanAppeal
    ? { allowed: (banAppeal!.used + 1) < BAN_APPEAL_LIMIT, used: banAppeal!.used + 1, remaining: Math.max(0, banAppeal!.remaining - 1), limit: BAN_APPEAL_LIMIT }
    : undefined;

  return NextResponse.json({ appeal, banAppeal: nextBanAppeal }, { status: 201 });
}
