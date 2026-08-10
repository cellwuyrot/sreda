import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { createNotification } from "@/lib/createNotification";
import { sanitizeText } from "@/lib/sanitize";
import { isStaffRole, staffIds } from "@/lib/businessChat";
import {
  isPaid,
  isSigned,
  parseDocuments,
  type BusinessPaymentView,
  type PaymentStatus,
} from "@/lib/businessPayment";

/**
 * BUSINESS-PAY: счёт глазами участника разговора (кнопка в шапке диалога).
 *
 *   GET  — счёт, документы и (после оплаты) подписанные договоры;
 *   POST — действия клиента: «sign» (ознакомился и подписал) и «declare» (оплатил).
 *
 * Здесь нет и не будет действия «проставить PAID»: подтверждает поступление денег
 * только администрация (/api/admin/business, PATCH). Иначе клиент одной кнопкой
 * открывал бы себе доступ к договорам, не заплатив ничего.
 *
 * ── Кто что видит ─────────────────────────────────────────────────
 *
 * Клиент разговора и вся администрация — как и с самим деловым чатом (доступ даёт
 * роль, см. lib/businessChat). Документы услуги приходят сразу — их надо читать
 * ДО подписи; подписанные договоры — только после PAID.
 */

interface Access {
  conversation: { id: string; kind: string; user1Id: string; user2Id: string };
  userId: string;
  /** Сам заказчик. Только он подписывает и заявляет об оплате. */
  isClient: boolean;
  isStaff: boolean;
}

async function resolveAccess(conversationId: string): Promise<Access | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversation = await prisma.directConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, kind: true, user1Id: true, user2Id: true },
  });
  if (!conversation) return NextResponse.json({ error: "Разговор не найден" }, { status: 404 });
  if (conversation.kind !== "BUSINESS") {
    return NextResponse.json({ error: "Это не деловой разговор" }, { status: 400 });
  }

  const userId = session.user.id;
  const isStaff = isStaffRole(session.user.role);
  const isClient = conversation.user1Id === userId;
  if (!isClient && !isStaff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { conversation, userId, isClient, isStaff };
}

/** Собрать счёт в том виде, в каком его ожидает интерфейс. */
async function buildView(conversationId: string, viewerId: string): Promise<BusinessPaymentView | null> {
  const payment = await prisma.businessPayment.findUnique({
    where: { conversationId },
    select: {
      id: true,
      conversationId: true,
      serviceId: true,
      title: true,
      description: true,
      amount: true,
      currency: true,
      requisites: true,
      status: true,
      documents: true,
      signedAt: true,
      signedName: true,
      declaredAt: true,
      declaredNote: true,
      paidAt: true,
      createdAt: true,
      service: { select: { title: true } },
      contracts: {
        select: {
          id: true,
          name: true,
          url: true,
          size: true,
          mime: true,
          createdAt: true,
          uploadedById: true,
          uploadedBy: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!payment) return null;

  const paid = isPaid(payment.status);

  return {
    id: payment.id,
    conversationId: payment.conversationId,
    serviceId: payment.serviceId,
    serviceTitle: payment.service?.title ?? null,
    title: payment.title,
    description: payment.description,
    amount: payment.amount,
    currency: payment.currency,
    requisites: payment.requisites,
    status: payment.status as PaymentStatus,
    documents: parseDocuments(payment.documents),
    signedAt: payment.signedAt?.toISOString() ?? null,
    signedName: payment.signedName,
    declaredAt: payment.declaredAt?.toISOString() ?? null,
    declaredNote: payment.declaredNote,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    /* Договоры ОТСЕКАЮТСЯ на сервере, а не прячутся в вёрстке: прислать их и
       не показать значило бы отдать ссылки любому, кто откроет ответ запроса. */
    contracts: paid
      ? payment.contracts.map((c) => ({
          id: c.id,
          name: c.name,
          url: c.url,
          size: c.size,
          mime: c.mime,
          uploadedByName: c.uploadedBy?.name ?? null,
          mine: c.uploadedById === viewerId,
          createdAt: c.createdAt.toISOString(),
        }))
      : [],
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await resolveAccess(id);
  if (access instanceof NextResponse) return access;

  const payment = await buildView(id, access.userId);
  return NextResponse.json({
    payment,
    /* Кто смотрит — решает сервер. Иначе одно и то же правило пришлось бы держать
       ещё и в компоненте — там же, где оно расходится с серверным. */
    party: access.isClient ? "client" : "staff",
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await resolveAccess(id);
  if (access instanceof NextResponse) return access;

  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; name?: unknown; note?: unknown }
    | null;
  const action = typeof body?.action === "string" ? body.action : "";

  const payment = await prisma.businessPayment.findUnique({
    where: { conversationId: id },
    select: { id: true, title: true, status: true, amount: true, currency: true },
  });
  if (!payment) return NextResponse.json({ error: "Счёт ещё не выставлен" }, { status: 404 });

  /* Оба действия — волеизъявление заказчика. Администратор, подписавший договор
     за клиента, — это не ошибка интерфейса, а подлог. */
  if (!access.isClient) {
    return NextResponse.json({ error: "Подписывает и оплачивает только заказчик" }, { status: 403 });
  }

  if (action === "sign") {
    if (isSigned(payment.status)) {
      /* Повторная подпись — не ошибка, а двойное нажатие. Отвечаем текущим
         состоянием, а не красным окном. */
      return NextResponse.json({ payment: await buildView(id, access.userId) });
    }
    const name = sanitizeText(typeof body?.name === "string" ? body.name : "").trim().slice(0, 200);
    if (name.length < 3) {
      return NextResponse.json({ error: "Укажите ФИО или название организации" }, { status: 400 });
    }

    await prisma.businessPayment.update({
      where: { conversationId: id },
      data: { status: "SIGNED", signedAt: new Date(), signedName: name },
    });

    await logAction({
      userId: access.userId,
      username: name,
      action: "business.payment.sign",
      target: payment.title,
      targetId: payment.id,
    });

    return NextResponse.json({ payment: await buildView(id, access.userId) });
  }

  if (action === "declare") {
    if (!isSigned(payment.status)) {
      return NextResponse.json({ error: "Сначала нужно ознакомиться с документами" }, { status: 400 });
    }
    if (isPaid(payment.status)) {
      return NextResponse.json({ payment: await buildView(id, access.userId) });
    }

    const note = sanitizeText(typeof body?.note === "string" ? body.note : "").trim().slice(0, 1000);
    await prisma.businessPayment.update({
      where: { conversationId: id },
      data: { status: "AWAITING", declaredAt: new Date(), declaredNote: note || null },
    });

    /* Заявление об оплате должно дойти до ВСЕЙ администрации, а не только до
       ведущего: деньги, зависшие из-за отпуска одного человека, — худший из исходов. */
    const staff = await staffIds(access.userId);
    for (const staffId of staff) {
      await createNotification({
        userId: staffId,
        type: "business",
        title: "Клиент сообщил об оплате",
        body: payment.title,
        link: `/admin/users?tab=business&dm=${id}`,
        actorId: access.userId,
      });
    }

    await logAction({
      userId: access.userId,
      username: "",
      action: "business.payment.declare",
      target: payment.title,
      targetId: payment.id,
      details: note || undefined,
    });

    return NextResponse.json({ payment: await buildView(id, access.userId) });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
