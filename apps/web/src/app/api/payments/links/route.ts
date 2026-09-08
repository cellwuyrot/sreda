import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { logAction } from "@/lib/audit";
import { createNotification } from "@/lib/createNotification";
import { readPaymentConfig, readPublicPaymentMethods, readVpnPaymentMethods } from "@/lib/paymentSettings";
import {
  PAYMENT_LINK_KIND_LABELS,
  PAYMENT_LINK_PLAN_LABELS,
  activatePaymentLink,
  findActiveReservation,
  isPaymentLinkKind,
  isPaymentLinkPlan,
  releaseExpiredReservations,
  reportPaymentLinkPaid,
  reservePaymentLink,
  reserveMinutesFrom,
  type PaymentLinkKind,
} from "@/lib/paymentLinks";

/**
 * PAYLINK: оплата подписки по ссылке со стороны плательщика.
 *
 * GET  — что показать в настройках профиля: цена, наличие свободных ссылок и
 *        выданная раньше ссылка, если человек к ней вернулся.
 * POST — два действия: `reserve` (выдать ссылку) и `paid` («я оплатил»).
 *
 * Нажатие «Я оплатил» — заявление плательщика, а не факт оплаты: ссылка банка
 * ничего сайту не сообщает. Поэтому подписку включает администратор — или сам
 * сервис, если включена настройка `paylink_auto_activate`.
 */

export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function readKindSettings(kind: PaymentLinkKind) {
  const config = await readPaymentConfig();
  const methods = kind === "VPN" ? await readVpnPaymentMethods() : await readPublicPaymentMethods();
  return {
    enabled: config.paylink_enabled === "1",
    autoActivate: config.paylink_auto_activate === "1",
    reserveMinutes: reserveMinutesFrom(config.paylink_reserve_minutes),
    instruction: config.paylink_instruction || "",
    priceMonth: methods.priceMonth,
    currency: methods.currency,
  };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return fail("Войдите в аккаунт.", 401);

  const kindParam = req.nextUrl.searchParams.get("kind");
  if (!isPaymentLinkKind(kindParam)) return fail("Неизвестная подписка.", 400);

  try {
    const settings = await readKindSettings(kindParam);
    await releaseExpiredReservations();

    const [offer, availableRows] = await Promise.all([
      findActiveReservation(session.user.id, kindParam),
      prisma.paymentLink.findMany({
        where: { kind: kindParam, status: "FREE" },
        select: { plan: true, amount: true, currency: true },
      }),
    ]);

    /* Планы, на которые есть свободные ссылки — чтобы не предлагать то, чего в пуле нет.
       Цена берётся из самой ссылки: счёт выставлен в банке на конкретную сумму. */
    const plansMap = new Map<string, { plan: string; planLabel: string; amount: number; currency: string; count: number }>();
    for (const row of availableRows) {
      const plan = isPaymentLinkPlan(row.plan) ? row.plan : "month";
      const key = `${plan}:${row.amount}:${row.currency}`;
      const prev = plansMap.get(key);
      if (prev) prev.count += 1;
      else
        plansMap.set(key, {
          plan,
          planLabel: PAYMENT_LINK_PLAN_LABELS[plan],
          amount: row.amount,
          currency: row.currency,
          count: 1,
        });
    }

    return NextResponse.json({
      kind: kindParam,
      kindLabel: PAYMENT_LINK_KIND_LABELS[kindParam],
      enabled: settings.enabled,
      instruction: settings.instruction,
      priceMonth: settings.priceMonth,
      currency: settings.currency,
      reserveMinutes: settings.reserveMinutes,
      plans: [...plansMap.values()].sort((a, b) => a.amount - b.amount),
      offer,
    });
  } catch (e) {
    console.error("[paylink] чтение предложения не удалось:", e);
    return fail("Не удалось прочитать условия оплаты. Повторите позже.", 500);
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return fail("Войдите в аккаунт.", 401);

  /* Защита пула: без ограничения один человек циклом запросов разобрал бы все
     свободные ссылки на бронь. */
  const limited = await rateLimit(req, `paylink:${session.user.id}`, { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    kind?: unknown;
    action?: unknown;
    plan?: unknown;
    linkId?: unknown;
    reference?: unknown;
  } | null;
  if (!body) return fail("Тело запроса не разобрано.", 400);

  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "reserve") {
      if (!isPaymentLinkKind(body.kind)) return fail("Неизвестная подписка.", 400);
      const settings = await readKindSettings(body.kind);
      if (!settings.enabled) return fail("Оплата по ссылке сейчас недоступна.", 409);

      const result = await reservePaymentLink({
        userId: session.user.id,
        kind: body.kind,
        plan: isPaymentLinkPlan(body.plan) ? body.plan : null,
        minutes: settings.reserveMinutes,
      });
      if (!result.ok) {
        return fail(
          "Свободных ссылок на оплату не осталось. Напишите администратору — он выпишет новую.",
          409,
        );
      }
      return NextResponse.json({ offer: result.offer, reused: result.reused });
    }

    if (action === "paid") {
      const linkId = typeof body.linkId === "string" ? body.linkId : "";
      if (!linkId) return fail("Не указана ссылка.", 400);

      const reported = await reportPaymentLinkPaid({
        userId: session.user.id,
        linkId,
        reference: typeof body.reference === "string" ? body.reference : null,
      });
      if (!reported.ok) {
        return fail(
          reported.reason === "not_found"
            ? "Ссылка не найдена или выдана не вам."
            : "По этой ссылке подписка уже выдана.",
          409,
        );
      }

      const settings = await readKindSettings(reported.offer.kind);

      /* Автоподтверждение — сознательный выбор владельца: сервис не может проверить
         зачисление и верит на слово. По умолчанию выключено. */
      if (settings.autoActivate) {
        const activated = await activatePaymentLink({ linkId, confirmedById: null });
        if (activated.ok) {
          await logAction({
            userId: session.user.id,
            username: session.user.username || session.user.name || "user",
            action: "update",
            target: "PaymentLink",
            targetId: linkId,
            details: `Автоподтверждение оплаты по ссылке · ${PAYMENT_LINK_KIND_LABELS[activated.kind]} · подписка ${activated.subscriptionId}`,
          });
          return NextResponse.json({
            status: "activated",
            expiresAt: activated.expiresAt,
            message: "Оплата принята, подписка включена.",
          });
        }
      }

      /* Администраторам — уведомление: иначе заявка будет ждать, пока кто-то сам
         не заглянет в раздел платежей. */
      const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
      const payer = session.user.username || session.user.name || "пользователь";
      await Promise.all(
        admins.map((admin) =>
          createNotification({
            userId: admin.id,
            type: "payment",
            title: "Заявка на подтверждение оплаты",
            body: `${payer}: ${PAYMENT_LINK_KIND_LABELS[reported.offer.kind]} · ${reported.offer.planLabel} · ${reported.offer.amount} ${reported.offer.currency}`,
            link: "/admin/payments",
            actorId: session.user.id,
          }).catch(() => {}),
        ),
      );

      return NextResponse.json({
        status: "awaiting",
        message: "Оплата отмечена. Подписка включится после сверки зачисления администратором.",
        offer: reported.offer,
      });
    }

    return fail("Неизвестное действие.", 400);
  } catch (e) {
    console.error("[paylink] действие плательщика не удалось:", e);
    return fail("Запрос не выполнен. Повторите позже.", 500);
  }
}
