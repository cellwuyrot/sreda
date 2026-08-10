import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { createNotification } from "@/lib/createNotification";
import { isStaffRole, staffIds } from "@/lib/businessChat";
import { isPaid, type BusinessContractView } from "@/lib/businessPayment";

/**
 * BUSINESS-PAY: подписанные договоры по оплаченному счёту.
 *
 *   GET    — список;
 *   POST   — добавить (и клиент, и администрация);
 *   DELETE — убрать своё (или любое — если ADMIN).
 *
 * ── Почему только после оплаты ─────────────────────────────────────
 *
 * Подписанный договор появляется только тогда, когда сделка состоялась. До этого
 * момента раздел закрыт с обеих сторон: обмен бумагами до оплаты — это переписка,
 * для неё есть сам чат с вложениями.
 *
 * Загружать могут ОБЕ стороны — это требование, а не послабление: подписанный
 * экземпляр есть у каждой, и односторонняя папка означала бы пересылку сканов
 * сообщениями и ручную подшивку.
 */

const MAX_CONTRACTS = 20;

async function resolve(conversationId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const payment = await prisma.businessPayment.findUnique({
    where: { conversationId },
    select: {
      id: true,
      title: true,
      status: true,
      conversation: { select: { id: true, kind: true, user1Id: true } },
    },
  });
  if (!payment || payment.conversation.kind !== "BUSINESS") {
    return { error: NextResponse.json({ error: "Счёт не найден" }, { status: 404 }) };
  }

  const userId = session.user.id;
  const isStaff = isStaffRole(session.user.role);
  const isClient = payment.conversation.user1Id === userId;
  if (!isClient && !isStaff) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!isPaid(payment.status)) {
    return {
      error: NextResponse.json({ error: "Раздел откроется после подтверждённой оплаты" }, { status: 403 }),
    };
  }

  return { session, payment, userId, isClient, isStaff };
}

async function listContracts(paymentId: string, viewerId: string): Promise<BusinessContractView[]> {
  const rows = await prisma.businessContract.findMany({
    where: { paymentId },
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
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    url: c.url,
    size: c.size,
    mime: c.mime,
    uploadedByName: c.uploadedBy?.name ?? null,
    mine: c.uploadedById === viewerId,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolve(id);
  if (ctx.error) return ctx.error;

  return NextResponse.json({ contracts: await listContracts(ctx.payment!.id, ctx.userId!) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolve(id);
  if (ctx.error) return ctx.error;
  const { payment, userId, isClient, session } = ctx;

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; url?: unknown; size?: unknown; mime?: unknown }
    | null;

  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 255) : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!name || !url) return NextResponse.json({ error: "Нужны название и адрес файла" }, { status: 400 });
  if (!url.startsWith("/uploads/")) {
    return NextResponse.json({ error: "Допускаются только файлы, загруженные в проект" }, { status: 400 });
  }

  const count = await prisma.businessContract.count({ where: { paymentId: payment!.id } });
  if (count >= MAX_CONTRACTS) {
    return NextResponse.json({ error: `Не более ${MAX_CONTRACTS} документов` }, { status: 400 });
  }

  await prisma.businessContract.create({
    data: {
      paymentId: payment!.id,
      name,
      url,
      size: typeof body?.size === "number" && body.size > 0 ? Math.round(body.size) : 0,
      mime: typeof body?.mime === "string" && body.mime ? body.mime.slice(0, 128) : null,
      uploadedById: userId!,
    },
  });

  /* Уведомляем ПРОТИВОПОЛОЖНУЮ сторону: договор, положенный в папку молча,
     равносилен неположенному — вторая сторона туда не заглядывает ежедневно. */
  if (isClient) {
    const staff = await staffIds(userId);
    for (const staffId of staff) {
      await createNotification({
        userId: staffId,
        type: "business",
        title: "Клиент добавил договор",
        body: name,
        link: `/admin/users?tab=business&dm=${id}`,
        actorId: userId,
      });
    }
  } else {
    await createNotification({
      userId: payment!.conversation.user1Id,
      type: "business",
      title: "Добавлен подписанный договор",
      body: name,
      link: `/connect?section=business&dm=${id}`,
      actorId: userId,
    });
  }

  await logAction({
    userId: userId!,
    username: session?.user.name ?? "",
    action: "business.contract.add",
    target: payment!.title,
    targetId: payment!.id,
    details: name,
  });

  return NextResponse.json({ contracts: await listContracts(payment!.id, userId!) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolve(id);
  if (ctx.error) return ctx.error;
  const { payment, userId, session } = ctx;

  const contractId = new URL(req.url).searchParams.get("contractId");
  if (!contractId) return NextResponse.json({ error: "Не указан документ" }, { status: 400 });

  const contract = await prisma.businessContract.findUnique({
    where: { id: contractId },
    select: { id: true, name: true, paymentId: true, uploadedById: true },
  });
  if (!contract || contract.paymentId !== payment!.id) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  /* Удалить можно только своё. Исключение — ADMIN: ему разбирать споры и чистить
     ошибочно загруженное. Редактор чужой договор удалить не может. */
  const isOwner = contract.uploadedById === userId;
  if (!isOwner && session?.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Можно убрать только свой документ" }, { status: 403 });
  }

  await prisma.businessContract.delete({ where: { id: contractId } });

  await logAction({
    userId: userId!,
    username: session?.user.name ?? "",
    action: "business.contract.remove",
    target: payment!.title,
    targetId: payment!.id,
    details: contract.name,
  });

  return NextResponse.json({ contracts: await listContracts(payment!.id, userId!) });
}
