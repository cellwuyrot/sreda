import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { createNotification } from "@/lib/createNotification";
import { sanitizeText } from "@/lib/sanitize";
import { isStaffRole } from "@/lib/businessChat";
import { parseDocuments, isPaymentStatus } from "@/lib/businessPayment";

/**
 * BUSINESS-PAY: подраздел «Бизнес» в /admin/users.
 *
 *   GET   — деловые разговоры с их счетами (поиск по клиенту и теме);
 *   POST  — выставить или перевыставить форму оплаты;
 *   PATCH — подтвердить оплату или вернуть счёт в неоплаченные.
 *
 * ── Кто имеет доступ ──────────────────────────────────────────────
 *
 * Только ADMIN. Редакторы ведут деловые разговоры и видят очередь, но цена и
 * подтверждение поступления денег — не их полномочия. Раздел живёт внутри
 * «Пользователи» рядом с «Сообществами»: это тоже работа с людьми, а не с каталогом.
 *
 * ── Почему документы копируются ────────────────────────────────────
 *
 * При выставлении берётся СНИМОК Service.documents. Ссылаться на услугу было бы
 * опасно: поправили шаблон договора — изменилось то, под чем клиент уже подписался.
 * По той же причине перевыставление счёта СБРАСЫВАЕТ подпись: условия стали другими,
 * и старая подпись к ним не относится.
 */

const MAX_AMOUNT = 100_000_000_00; // 100 млн рублей в копейках — защита от опечатки.

async function adminOnly() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(req: NextRequest) {
  const guard = await adminOnly();
  if (guard.error) return guard.error;

  const search = (new URL(req.url).searchParams.get("q") ?? "").trim();

  const conversations = await prisma.directConversation.findMany({
    where: {
      kind: "BUSINESS",
      ...(search
        ? {
            /* Ищем только по КЛИЕНТУ (user1). Сторона администрации — техническое
               место, и поиск по ней выдавал бы все разговоры сразу. */
            user1: {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { username: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    },
    select: {
      id: true,
      appealId: true,
      createdAt: true,
      lastMessageAt: true,
      user1: { select: { id: true, name: true, username: true, email: true, avatar: true } },
      handler: { select: { id: true, name: true } },
      payment: {
        select: {
          id: true,
          title: true,
          amount: true,
          currency: true,
          status: true,
          serviceId: true,
          description: true,
          requisites: true,
          documents: true,
          signedAt: true,
          signedName: true,
          declaredAt: true,
          declaredNote: true,
          paidAt: true,
          service: { select: { id: true, title: true } },
          _count: { select: { contracts: true } },
        },
      },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
  });

  /* Список услуг отдаётся вместе с разговорами: форма выставления начинается с
     выбора услуги, и второй запрос ради десятка строк — лишний круг. */
  const services = await prisma.service.findMany({
    where: { active: true },
    select: { id: true, title: true, documents: true },
    orderBy: { order: "asc" },
  });

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      appealId: c.appealId,
      createdAt: c.createdAt,
      lastMessageAt: c.lastMessageAt,
      client: c.user1,
      handlerName: c.handler?.name ?? null,
      payment: c.payment
        ? {
            ...c.payment,
            documents: parseDocuments(c.payment.documents),
            serviceTitle: c.payment.service?.title ?? null,
            contractCount: c.payment._count.contracts,
          }
        : null,
    })),
    services: services.map((s) => ({
      id: s.id,
      title: s.title,
      documentCount: parseDocuments(s.documents).length,
    })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await adminOnly();
  if (guard.error) return guard.error;
  const session = guard.session!;

  const body = (await req.json().catch(() => null)) as {
    conversationId?: unknown;
    serviceId?: unknown;
    title?: unknown;
    description?: unknown;
    amount?: unknown;
    currency?: unknown;
    requisites?: unknown;
  } | null;

  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  if (!conversationId) {
    return NextResponse.json({ error: "Не указан разговор" }, { status: 400 });
  }

  const conversation = await prisma.directConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, kind: true, user1Id: true },
  });
  if (!conversation) return NextResponse.json({ error: "Разговор не найден" }, { status: 404 });
  if (conversation.kind !== "BUSINESS") {
    /* Счёт в личной переписке — это уже не модерация, а вымогательство. */
    return NextResponse.json({ error: "Счёт возможен только в деловом разговоре" }, { status: 400 });
  }

  const title = sanitizeText(typeof body?.title === "string" ? body.title : "").trim().slice(0, 200);
  if (!title) return NextResponse.json({ error: "Нужно название счёта" }, { status: 400 });

  const amountRaw = typeof body?.amount === "number" ? Math.round(body.amount) : NaN;
  if (!Number.isFinite(amountRaw) || amountRaw < 0 || amountRaw > MAX_AMOUNT) {
    return NextResponse.json({ error: "Неверная сумма" }, { status: 400 });
  }

  const serviceId = typeof body?.serviceId === "string" && body.serviceId ? body.serviceId : null;
  let documents: unknown[] = [];
  let service: { id: string; title: string } | null = null;
  if (serviceId) {
    const found = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, title: true, documents: true },
    });
    if (!found) return NextResponse.json({ error: "Услуга не найдена" }, { status: 404 });
    service = { id: found.id, title: found.title };
    documents = parseDocuments(found.documents);
  }

  const description = sanitizeText(typeof body?.description === "string" ? body.description : "")
    .trim()
    .slice(0, 4000);
  const requisites = sanitizeText(typeof body?.requisites === "string" ? body.requisites : "")
    .trim()
    .slice(0, 2000);
  const currency =
    typeof body?.currency === "string" && /^[A-Z]{3}$/.test(body.currency) ? body.currency : "RUB";

  const shared = {
    serviceId,
    title,
    description: description || null,
    amount: amountRaw,
    currency,
    requisites: requisites || null,
    documents: documents.length ? (documents as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };

  const payment = await prisma.businessPayment.upsert({
    where: { conversationId },
    create: { conversationId, createdById: session.user.id, ...shared },
    update: {
      ...shared,
      /* Перевыставление — это новые условия. Подпись и заявление об оплате
         сбрасываются: они относились к прежней сумме и прежним бумагам. */
      status: "UNPAID",
      signedAt: null,
      signedName: null,
      declaredAt: null,
      declaredNote: null,
      paidAt: null,
    },
    select: { id: true, status: true },
  });

  await createNotification({
    userId: conversation.user1Id,
    type: "business",
    title: "Счёт к оплате",
    body: title,
    link: `/connect?section=business&dm=${conversationId}`,
    actorId: session.user.id,
  });

  await logAction({
    userId: session.user.id,
    username: session.user.name ?? "",
    action: "business.payment.issue",
    target: title,
    targetId: payment.id,
    details: `${(amountRaw / 100).toFixed(2)} ${currency}${service ? ` · ${service.title}` : ""}`,
  });

  return NextResponse.json({ ok: true, paymentId: payment.id, status: payment.status });
}

export async function PATCH(req: NextRequest) {
  const guard = await adminOnly();
  if (guard.error) return guard.error;
  const session = guard.session!;

  const body = (await req.json().catch(() => null)) as
    | { conversationId?: unknown; status?: unknown }
    | null;

  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const status = body?.status;
  if (!conversationId || !isPaymentStatus(status)) {
    return NextResponse.json({ error: "Неверные данные" }, { status: 400 });
  }

  const payment = await prisma.businessPayment.findUnique({
    where: { conversationId },
    select: { id: true, title: true, status: true, conversation: { select: { user1Id: true } } },
  });
  if (!payment) return NextResponse.json({ error: "Счёт не выставлен" }, { status: 404 });

  const updated = await prisma.businessPayment.update({
    where: { conversationId },
    data: {
      status,
      /* Дата оплаты ставится только вместе со статусом PAID и снимается при откате:
         оставшаяся от прошлого раза дата в неоплаченном счёте читалась бы как сбой. */
      paidAt: status === "PAID" ? new Date() : null,
    },
    select: { id: true, status: true, paidAt: true },
  });

  await createNotification({
    userId: payment.conversation.user1Id,
    type: "business",
    title: status === "PAID" ? "Оплата подтверждена" : "Статус счёта изменён",
    body: payment.title,
    link: `/connect?section=business&dm=${conversationId}`,
    actorId: session.user.id,
  });

  await logAction({
    userId: session.user.id,
    username: session.user.name ?? "",
    action: "business.payment.status",
    target: payment.title,
    targetId: payment.id,
    details: `${payment.status} → ${status}`,
  });

  return NextResponse.json({ ok: true, status: updated.status, paidAt: updated.paidAt });
}

/** Проверка используется тестами и соседними маршрутами. */
export { isStaffRole };
