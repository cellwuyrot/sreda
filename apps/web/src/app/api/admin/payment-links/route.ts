import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { createNotification } from "@/lib/createNotification";
import {
  MAX_LINKS_PER_IMPORT,
  PAYMENT_LINK_KIND_LABELS,
  PAYMENT_LINK_PLAN_LABELS,
  activatePaymentLink,
  isPaymentLinkKind,
  isPaymentLinkPlan,
  parsePaymentLinkList,
  releaseExpiredReservations,
  releasePaymentLink,
  summarizePaymentLinks,
} from "@/lib/paymentLinks";

/**
 * PAYLINK: пул платёжных ссылок в админ-панели. Только ADMIN — как и остальные
 * платёжные маршруты: здесь выдаются подписки за деньги.
 *
 * GET    — список и сводка по виду подписки.
 * POST   — загрузка партии ссылок (админ создаёт их в банке сразу пачкой).
 * PATCH  — confirm | release | disable | enable.
 * DELETE — удаление неиспользованной ссылки.
 *
 * Использованная ссылка не удаляется и не возвращается в пул: это след платежа,
 * по которому выдана подписка.
 */

export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorText(e: unknown): string {
  const code = typeof e === "object" && e && "code" in e ? String((e as { code?: unknown }).code) : "";
  const message = e instanceof Error ? e.message : String(e);
  return code ? `${code}: ${message}` : message;
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: fail("Сессия истекла. Войдите в аккаунт администратора заново.", 401) } as const;
  }
  if (session.user.role !== "ADMIN") {
    return { error: fail("Доступно только администратору.", 403) } as const;
  }
  return { session } as const;
}

const LIST_SELECT = {
  id: true,
  kind: true,
  plan: true,
  amount: true,
  currency: true,
  url: true,
  label: true,
  status: true,
  reservedAt: true,
  reservationExpiresAt: true,
  paidReportedAt: true,
  payerReference: true,
  usedAt: true,
  subscriptionId: true,
  note: true,
  createdAt: true,
  reservedBy: { select: { id: true, username: true, name: true } },
  usedBy: { select: { id: true, username: true, name: true } },
  confirmedBy: { select: { username: true, name: true } },
} as const;

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const kindParam = req.nextUrl.searchParams.get("kind");
  const kind = isPaymentLinkKind(kindParam) ? kindParam : null;

  try {
    /* Сначала возвращаем просроченные брони: иначе админ видит ссылки занятыми,
       а по делу они свободны. */
    await releaseExpiredReservations();

    const links = await prisma.paymentLink.findMany({
      where: kind ? { kind } : {},
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 500,
      select: LIST_SELECT,
    });

    const all = await prisma.paymentLink.findMany({
      where: kind ? { kind } : {},
      select: { status: true },
    });

    return NextResponse.json({ links, stats: summarizePaymentLinks(all) });
  } catch (e) {
    console.error("[paylink] список ссылок не прочитан:", e);
    return fail(`Не удалось прочитать ссылки: ${errorText(e)}`, 500);
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;
  const session = guard.session!;

  const body = (await req.json().catch(() => null)) as {
    kind?: unknown;
    plan?: unknown;
    amount?: unknown;
    currency?: unknown;
    label?: unknown;
    note?: unknown;
    links?: unknown;
  } | null;
  if (!body) return fail("Тело запроса не разобрано.", 400);

  if (!isPaymentLinkKind(body.kind)) return fail("Укажите подписку: Premium или Ускоренный интернет.", 400);
  if (!isPaymentLinkPlan(body.plan)) return fail("Укажите срок подписки.", 400);

  const amount = Number.isFinite(body.amount) ? Math.max(0, Math.round(Number(body.amount))) : 0;
  const currency =
    typeof body.currency === "string" && /^[A-Za-z]{3}$/.test(body.currency)
      ? body.currency.toUpperCase()
      : "RUB";
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 200) : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : null;

  const parsed = parsePaymentLinkList(body.links);
  if (parsed.urls.length === 0) {
    return fail(
      parsed.invalid.length > 0
        ? `Ни одна ссылка не принята. Нужен адрес вида https://b2b.cbrpay.ru/... Не разобрано: ${parsed.invalid.slice(0, 3).join(", ")}`
        : "Вставьте хотя бы одну платёжную ссылку.",
      400,
    );
  }
  if (parsed.urls.length > MAX_LINKS_PER_IMPORT) {
    return fail(`За раз можно загрузить не больше ${MAX_LINKS_PER_IMPORT} ссылок.`, 400);
  }

  try {
    /* Ссылки, уже загруженные раньше, не дублируем и не теряем остальные:
       админ часто вставляет весь список из банка заново. */
    const known = await prisma.paymentLink.findMany({
      where: { url: { in: parsed.urls } },
      select: { url: true },
    });
    const knownSet = new Set(known.map((k) => k.url));
    const fresh = parsed.urls.filter((u) => !knownSet.has(u));

    if (fresh.length === 0) {
      return NextResponse.json({
        created: 0,
        skipped: knownSet.size,
        invalid: parsed.invalid.length,
        message: "Все ссылки уже загружены раньше.",
      });
    }

    const result = await prisma.paymentLink.createMany({
      data: fresh.map((url) => ({
        kind: body.kind as string,
        plan: body.plan as string,
        amount,
        currency,
        url,
        label,
        note,
        status: "FREE",
        createdById: session.user.id,
      })),
      skipDuplicates: true,
    });

    await logAction({
      userId: session.user.id,
      username: session.user.username || session.user.name || "admin",
      action: "create",
      target: "PaymentLink",
      details: `Загружено ссылок: ${result.count} · ${PAYMENT_LINK_KIND_LABELS[body.kind]} · ${PAYMENT_LINK_PLAN_LABELS[body.plan]} · ${amount} ${currency}`,
    });

    return NextResponse.json({
      created: result.count,
      skipped: knownSet.size + parsed.duplicates.length,
      invalid: parsed.invalid.length,
    });
  } catch (e) {
    console.error("[paylink] загрузка ссылок не удалась:", e);
    return fail(`Ссылки не загружены: ${errorText(e)}`, 500);
  }
}

export async function PATCH(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;
  const session = guard.session!;

  const body = (await req.json().catch(() => null)) as { linkId?: unknown; action?: unknown } | null;
  const linkId = typeof body?.linkId === "string" ? body.linkId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!linkId) return fail("Не указана ссылка.", 400);

  try {
    if (action === "confirm") {
      const result = await activatePaymentLink({ linkId, confirmedById: session.user.id });
      if (!result.ok) {
        const messages: Record<string, string> = {
          not_found: "Ссылка не найдена.",
          wrong_state: "По этой ссылке подписка уже выдана или ссылка никому не выдана.",
          no_payer: "Ссылка никому не выдана — подтверждать нечего.",
          user_gone: "Профиль плательщика удалён.",
        };
        return fail(messages[result.reason] ?? "Подтвердить оплату не удалось.", 409);
      }

      await createNotification({
        userId: result.userId,
        type: "payment",
        title:
          result.kind === "VPN"
            ? "Подписка «Ускоренный интернет» активна"
            : "Подписка Premium активна",
        body: result.expiresAt
          ? `Оплата подтверждена. Срок действия — до ${result.expiresAt.toLocaleDateString("ru-RU")}.`
          : "Оплата подтверждена. Подписка бессрочная.",
        link: "/settings",
      }).catch(() => {});

      await logAction({
        userId: session.user.id,
        username: session.user.username || session.user.name || "admin",
        action: "update",
        target: "PaymentLink",
        targetId: linkId,
        details: `Оплата по ссылке подтверждена · ${PAYMENT_LINK_KIND_LABELS[result.kind]} · подписка ${result.subscriptionId}`,
      });

      return NextResponse.json({ success: true, subscriptionId: result.subscriptionId, expiresAt: result.expiresAt });
    }

    if (action === "release") {
      const result = await releasePaymentLink(linkId);
      if (!result.ok) {
        return fail(
          result.reason === "not_found"
            ? "Ссылка не найдена."
            : "По ссылке уже выдана подписка — вернуть её в пул нельзя.",
          409,
        );
      }
      await logAction({
        userId: session.user.id,
        username: session.user.username || session.user.name || "admin",
        action: "update",
        target: "PaymentLink",
        targetId: linkId,
        details: "Ссылка возвращена в пул",
      });
      return NextResponse.json({ success: true });
    }

    if (action === "disable" || action === "enable") {
      const link = await prisma.paymentLink.findUnique({
        where: { id: linkId },
        select: { status: true },
      });
      if (!link) return fail("Ссылка не найдена.", 404);
      if (link.status === "USED") return fail("Ссылка уже использована.", 409);
      if (action === "disable" && (link.status === "RESERVED" || link.status === "AWAITING")) {
        return fail("Ссылка выдана плательщику. Сначала верните её в пул.", 409);
      }

      await prisma.paymentLink.update({
        where: { id: linkId },
        data: { status: action === "disable" ? "DISABLED" : "FREE" },
      });
      await logAction({
        userId: session.user.id,
        username: session.user.username || session.user.name || "admin",
        action: "update",
        target: "PaymentLink",
        targetId: linkId,
        details: action === "disable" ? "Ссылка отключена" : "Ссылка включена",
      });
      return NextResponse.json({ success: true });
    }

    return fail("Неизвестное действие.", 400);
  } catch (e) {
    console.error("[paylink] действие над ссылкой не удалось:", e);
    return fail(`Не удалось изменить ссылку: ${errorText(e)}`, 500);
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;
  const session = guard.session!;

  const linkId = req.nextUrl.searchParams.get("id") || "";
  if (!linkId) return fail("Не указана ссылка.", 400);

  try {
    const link = await prisma.paymentLink.findUnique({
      where: { id: linkId },
      select: { status: true },
    });
    if (!link) return fail("Ссылка не найдена.", 404);
    if (link.status === "USED") {
      return fail("По ссылке выдана подписка — удалять её нельзя. Отключите вместо удаления.", 409);
    }

    await prisma.paymentLink.delete({ where: { id: linkId } });
    await logAction({
      userId: session.user.id,
      username: session.user.username || session.user.name || "admin",
      action: "delete",
      target: "PaymentLink",
      targetId: linkId,
      details: "Ссылка удалена из пула",
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[paylink] удаление ссылки не удалось:", e);
    return fail(`Не удалось удалить ссылку: ${errorText(e)}`, 500);
  }
}
