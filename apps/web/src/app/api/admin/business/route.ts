import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { createNotification } from "@/lib/createNotification";
import { sanitizeText } from "@/lib/sanitize";
import { isStaffRole } from "@/lib/businessChat";
import { parseDocuments, isPaymentStatus, type PaymentStatus } from "@/lib/businessPayment";
/* BUSINESS-SUB: подписка и разовый счёт считаются одной и той же машиной переходов. */
import {
  applyAction,
  initialNextDueAt,
  isBillingPeriod,
  isPaymentMode,
  type BillingPeriod,
  type PaymentFlowState,
  type PaymentMode,
} from "@/lib/businessPaymentFlow";
/* PAY-TEMPLATE: реквизиты берутся из шаблона, а не набиваются руками каждый раз. */
import {
  MAX_REQUISITES_PER_OWNER,
  bumpRequisiteUsage,
  clearDefaults,
  listRequisitesFor,
  requisiteText,
  resolveRequisites,
} from "@/lib/paymentRequisites";

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
  const session = guard.session!;

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
          requisiteId: true,
          documents: true,
          signedAt: true,
          signedName: true,
          declaredAt: true,
          declaredNote: true,
          paidAt: true,
          mode: true,
          period: true,
          cycles: true,
          paidCycles: true,
          nextDueAt: true,
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
  /* PAY-TEMPLATE: шаблоны реквизитов этого администратора и общие проекта —
     форма счёта должна предлагать выбор, а не требовать ручного ввода. */
  const requisites = await listRequisitesFor(session.user.id, "BUSINESS");

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
    /* Текст считает сервер: в счёт попадёт ровно то, что видно в форме. */
    requisites: requisites.map((r) => ({
      id: r.id,
      name: r.name,
      shared: r.ownerId === null,
      isDefault: r.isDefault,
      mode: r.mode,
      period: r.period,
      preview: requisiteText(r),
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
    mode?: unknown;
    period?: unknown;
    cycles?: unknown;
    /* PAY-TEMPLATE */
    requisiteId?: unknown;
    saveAsTemplate?: unknown;
    templateName?: unknown;
    templateShared?: unknown;
    templateDefault?: unknown;
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

  /* BUSINESS-SUB: способ выставления. Сумма в подписке — цена ОДНОГО периода,
     а не всего договора: именно её клиент видит в банке каждый раз. */
  const mode: PaymentMode = isPaymentMode(body?.mode) ? body.mode : "ONE_TIME";
  const period: BillingPeriod | null =
    mode === "SUBSCRIPTION" ? (isBillingPeriod(body?.period) ? body.period : "MONTH") : null;

  /* Число списаний: 0 или пусто трактуется как «бессрочно, до отмены». Ограничение
     сверху — от опечатки: 120 периодов это уже десять лет ежемесячных платежей. */
  let cycles: number | null = null;
  if (mode === "SUBSCRIPTION" && typeof body?.cycles === "number" && Number.isFinite(body.cycles)) {
    const rounded = Math.round(body.cycles);
    if (rounded > 0) cycles = Math.min(rounded, 120);
  }

  /* PAY-TEMPLATE: откуда берётся текст реквизитов.

     Порядок: ручной ввод → выбранный шаблон → шаблон по умолчанию (сначала личный
     администратора, затем общий) → общие реквизиты проекта из «Платежей».
     Счёт без реквизитов — самая частая причина того, почему клиент «собирался,
     но не заплатил», поэтому цепочка заканчивается настройками, а не пустотой. */
  const requisiteIdRaw =
    typeof body?.requisiteId === "string" && body.requisiteId ? body.requisiteId : null;
  let resolved;
  try {
    resolved = await resolveRequisites({
      manual: requisites,
      requisiteId: requisiteIdRaw,
      userId: session.user.id,
      scope: "BUSINESS",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Не удалось подставить реквизиты" },
      { status: 400 },
    );
  }
  const requisitesFinal = resolved.text;

  const shared = {
    serviceId,
    title,
    description: description || null,
    amount: amountRaw,
    currency,
    requisites: requisitesFinal || null,
    /* Ссылка на шаблон — только след происхождения. Условия счёта живут в снимке выше. */
    requisiteId: resolved.requisiteId,
    mode,
    period,
    cycles,
    documents: documents.length ? (documents as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };

  /* PAY-TEMPLATE: что именно меняется.

     Раньше ЛЮБОЕ сохранение формы сбрасывало подпись клиента и возвращало счёт в
     UNPAID — даже если поправили опечатку в описании. Из-за этого править счёт
     было нельзя: цена ошибки — потерянная подпись и повторное ознакомление
     с документами. Теперь сброс происходит только при изменении СУЩЕСТВЕННЫХ
     условий: суммы, валюты, способа выставления, периода, числа списаний или
     услуги (а значит и комплекта документов). Название, описание и реквизиты
     правятся свободно: они не меняют то, под чем клиент подписался. */
  const existing = await prisma.businessPayment.findUnique({
    where: { conversationId },
    select: {
      amount: true,
      currency: true,
      mode: true,
      period: true,
      cycles: true,
      serviceId: true,
      status: true,
      signedAt: true,
    },
  });

  const termsChanged =
    !existing ||
    existing.amount !== amountRaw ||
    existing.currency !== currency ||
    existing.mode !== mode ||
    (existing.period ?? null) !== period ||
    (existing.cycles ?? null) !== cycles ||
    (existing.serviceId ?? null) !== serviceId;

  const resetBlock = {
    nextDueAt: initialNextDueAt(mode, new Date()),
    paidCycles: 0,
    status: "UNPAID",
    signedAt: null,
    signedName: null,
    declaredAt: null,
    declaredNote: null,
    paidAt: null,
  } as const;

  const payment = await prisma.businessPayment.upsert({
    where: { conversationId },
    create: {
      conversationId,
      createdById: session.user.id,
      ...shared,
      /* У подписки первый платёж — сразу: подписка начинается с оплаты,
         а не с месяца бесплатной работы. */
      nextDueAt: initialNextDueAt(mode, new Date()),
    },
    update: termsChanged ? { ...shared, ...resetBlock } : { ...shared },
    select: { id: true, status: true },
  });

  await createNotification({
    userId: conversation.user1Id,
    type: "business",
    /* Правка описания не должна выглядеть как новый счёт: клиент перестанет
       верить уведомлениям быстрее, чем заплатит. */
    title: termsChanged ? "Счёт к оплате" : "Счёт обновлён",
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
    details:
      `${(amountRaw / 100).toFixed(2)} ${currency}${service ? ` · ${service.title}` : ""}` +
      ` · реквизиты: ${resolved.source}` +
      `${termsChanged ? "" : " · правка без смены условий"}`,
  });

  await bumpRequisiteUsage(resolved.requisiteId);

  /* PAY-TEMPLATE: «Сохранить как шаблон» прямо из формы счёта.

     Реквизиты чаще всего первый раз набирают именно здесь, в бою. Заставлять
     после этого идти в настройки и повторять ввод — верный способ того, что
     шаблонов так и не появится. Сохраняем готовым текстом (bodyOverride):
     разбирать свободный текст на КПП и БИК угадыванием мы не станем. */
  let templateId: string | null = null;
  if (body?.saveAsTemplate === true && requisitesFinal) {
    const templateName = sanitizeText(
      typeof body?.templateName === "string" && body.templateName ? body.templateName : title,
    )
      .trim()
      .slice(0, 120);
    const templateOwnerId = body?.templateShared === true ? null : session.user.id;
    const count = await prisma.paymentRequisite.count({ where: { ownerId: templateOwnerId } });
    if (templateName && count < MAX_REQUISITES_PER_OWNER) {
      if (body?.templateDefault === true) await clearDefaults("BUSINESS", templateOwnerId);
      const template = await prisma.paymentRequisite.create({
        data: {
          name: templateName,
          scope: "BUSINESS",
          ownerId: templateOwnerId,
          isDefault: body?.templateDefault === true,
          bodyOverride: requisitesFinal.slice(0, 4000),
          mode,
          period,
          createdById: session.user.id,
          createdByName: (session.user.name ?? "").slice(0, 120),
        },
        select: { id: true, name: true },
      });
      templateId = template.id;
      /* Связываем счёт со свежим шаблоном: видно, откуда взялись реквизиты. */
      await prisma.businessPayment.update({
        where: { id: payment.id },
        data: { requisiteId: template.id },
      });
      await logAction({
        userId: session.user.id,
        username: session.user.name ?? "",
        action: "payments.requisite.create",
        target: template.name,
        targetId: template.id,
        details: `из формы счёта, ${templateOwnerId ? "личный" : "общий"}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    paymentId: payment.id,
    status: payment.status,
    /* Форма покажет честный итог: сброшена ли подпись и каков шаблон. */
    termsChanged,
    signatureReset: termsChanged && Boolean(existing?.signedAt),
    requisiteSource: resolved.source,
    requisiteId: resolved.requisiteId ?? templateId,
    templateId,
  });
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
    select: {
      id: true,
      title: true,
      status: true,
      mode: true,
      period: true,
      cycles: true,
      paidCycles: true,
      nextDueAt: true,
      conversation: { select: { user1Id: true } },
    },
  });
  if (!payment) return NextResponse.json({ error: "Счёт не выставлен" }, { status: 404 });

  /* BUSINESS-SUB: «оплата получена» и «отменить» — шаги машины переходов, а не
     прямая запись статуса: у подписки подтверждение ещё и считает следующий срок. */
  const now = new Date();
  const state: PaymentFlowState = {
    status: payment.status as PaymentStatus,
    mode: isPaymentMode(payment.mode) ? payment.mode : "ONE_TIME",
    period: isBillingPeriod(payment.period) ? payment.period : null,
    cycles: payment.cycles ?? null,
    paidCycles: payment.paidCycles ?? 0,
    nextDueAt: payment.nextDueAt ?? null,
  };

  const step = applyAction(state, status === "PAID" ? "confirm" : "revoke", now);
  if (!step.ok) {
    return NextResponse.json({ error: step.error ?? "Шаг невозможен" }, { status: 400 });
  }

  const updated = await prisma.businessPayment.update({
    where: { conversationId },
    data: {
      status: step.state.status,
      paidCycles: step.state.paidCycles,
      nextDueAt: step.state.nextDueAt,
      /* Дата оплаты ставится только вместе со статусом PAID и снимается при откате:
         оставшаяся от прошлого раза дата в неоплаченном счёте читалась бы как сбой. */
      paidAt: step.state.status === "PAID" ? now : null,
    },
    select: { id: true, status: true, paidAt: true, paidCycles: true, nextDueAt: true },
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
    details: `${payment.status} → ${step.state.status}${
      state.mode === "SUBSCRIPTION" ? ` · периодов оплачено: ${step.state.paidCycles}` : ""
    }`,
  });

  return NextResponse.json({
    ok: true,
    status: updated.status,
    paidAt: updated.paidAt,
    paidCycles: updated.paidCycles,
    nextDueAt: updated.nextDueAt,
  });
}

/** Проверка используется тестами и соседними маршрутами. */
export { isStaffRole };
