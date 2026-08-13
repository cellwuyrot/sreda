import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { rateLimit } from "@/lib/rateLimit";
import {
  MAX_REQUISITES_PER_OWNER,
  REQUISITE_SELECT,
  canUseRequisite,
  clearDefaults,
  isRequisiteScope,
  listRequisitesFor,
  parseRequisitePatch,
  requisiteDraftFromSettings,
  requisiteText,
  type RequisiteScope,
} from "@/lib/paymentRequisites";
import { readBusinessRequisitesText } from "@/lib/paymentSettings";

/**
 * PAY-TEMPLATE: шаблоны платёжных реквизитов.
 *
 *   GET  — шаблоны, доступные администратору (свои и общие проекта);
 *   POST — создать шаблон: с нуля, копией другого или переносом общих настроек.
 *
 * Только ADMIN: реквизиты — это деньги проекта, а не рабочая задача редактора.
 * Личные шаблоны других администраторов не отдаются даже другому админу: человек
 * держит там свои банковские данные, а не общий справочник.
 */

async function adminOnly() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

type Row = Awaited<ReturnType<typeof listRequisitesFor>>[number];

export function toDto(row: Row, userId: string) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    shared: row.ownerId === null,
    mine: row.ownerId === userId,
    ownerName: row.owner?.name ?? row.owner?.username ?? null,
    isDefault: row.isDefault,
    orgName: row.orgName,
    inn: row.inn,
    kpp: row.kpp,
    bank: row.bank,
    bik: row.bik,
    account: row.account,
    corrAccount: row.corrAccount,
    purpose: row.purpose,
    sbpEnabled: row.sbpEnabled,
    sbpPhone: row.sbpPhone,
    sbpBank: row.sbpBank,
    sbpRecipient: row.sbpRecipient,
    acquiringEnabled: row.acquiringEnabled,
    acquiringProvider: row.acquiringProvider,
    acquiringLink: row.acquiringLink,
    acquiringMerchant: row.acquiringMerchant,
    comment: row.comment ?? "",
    bodyOverride: row.bodyOverride ?? "",
    mode: row.mode,
    period: row.period,
    usedCount: row.usedCount,
    lastUsedAt: row.lastUsedAt,
    createdByName: row.createdByName,
    updatedAt: row.updatedAt,
    /* Готовый текст считает сервер: администратор должен видеть ровно то, что
       попадёт в счёт, а не свою версию сборки тех же полей. */
    preview: requisiteText(row),
  };
}

export async function GET(req: NextRequest) {
  const guard = await adminOnly();
  if (guard.error) return guard.error;
  const session = guard.session!;

  const scopeParam = new URL(req.url).searchParams.get("scope");
  const scope: RequisiteScope | undefined = isRequisiteScope(scopeParam) ? scopeParam : undefined;

  const rows = await listRequisitesFor(session.user.id, scope);

  return NextResponse.json({
    requisites: rows.map((r) => toDto(r, session.user.id)),
    /* Текст общих реквизитов проекта — то, что подставится, если шаблонов нет. */
    settingsPreview: (await readBusinessRequisitesText()) || "",
    limit: MAX_REQUISITES_PER_OWNER,
  });
}

export async function POST(req: NextRequest) {
  const guard = await adminOnly();
  if (guard.error) return guard.error;
  const session = guard.session!;

  const limited = await rateLimit(req, `pay-requisite:${session.user.id}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });

  /* Заготовка: копия другого шаблона или перенос общих настроек. Первый шаблон не
     должен требовать повторного ввода того, что уже заполнено в «Платежах». */
  let base: Record<string, unknown> = {};
  let copiedFrom = "";
  if (typeof body.copyFromId === "string" && body.copyFromId) {
    const source = await prisma.paymentRequisite.findUnique({
      where: { id: body.copyFromId },
      select: REQUISITE_SELECT,
    });
    if (!source || !canUseRequisite(source, session.user.id)) {
      return NextResponse.json({ error: "Шаблон для копирования не найден" }, { status: 404 });
    }
    base = {
      name: `${source.name} — копия`,
      scope: source.scope,
      orgName: source.orgName,
      inn: source.inn,
      kpp: source.kpp,
      bank: source.bank,
      bik: source.bik,
      account: source.account,
      corrAccount: source.corrAccount,
      purpose: source.purpose,
      sbpEnabled: source.sbpEnabled,
      sbpPhone: source.sbpPhone,
      sbpBank: source.sbpBank,
      sbpRecipient: source.sbpRecipient,
      acquiringEnabled: source.acquiringEnabled,
      acquiringProvider: source.acquiringProvider,
      acquiringLink: source.acquiringLink,
      acquiringMerchant: source.acquiringMerchant,
      comment: source.comment ?? "",
      bodyOverride: source.bodyOverride ?? "",
      mode: source.mode,
      period: source.period,
    };
    copiedFrom = source.name;
  } else if (body.fromSettings === true) {
    base = { ...(await requisiteDraftFromSettings()) };
  }

  const parsed = parseRequisitePatch(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const data: Record<string, unknown> = { ...base, ...parsed.patch };
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Укажите название шаблона" }, { status: 400 });

  const scope = isRequisiteScope(data.scope) ? data.scope : "BUSINESS";
  /* По умолчанию шаблон ЛИЧНЫЙ: человек заводит свои реквизиты, а не публикует их
     всей администрации. Общий — только осознанным выбором. */
  const ownerId = body.shared === true ? null : session.user.id;

  const count = await prisma.paymentRequisite.count({ where: { ownerId } });
  if (count >= MAX_REQUISITES_PER_OWNER) {
    return NextResponse.json(
      { error: `Больше ${MAX_REQUISITES_PER_OWNER} шаблонов не помогают, а мешают. Удалите лишние.` },
      { status: 400 },
    );
  }

  const isDefault = data.isDefault === true;
  if (isDefault) await clearDefaults(scope, ownerId);

  delete data.name;
  delete data.scope;
  delete data.isDefault;

  const created = await prisma.paymentRequisite.create({
    data: {
      ...(data as Record<string, never>),
      name,
      scope,
      ownerId,
      isDefault,
      createdById: session.user.id,
      createdByName: (session.user.name ?? "").slice(0, 120),
    },
    select: REQUISITE_SELECT,
  });

  await logAction({
    userId: session.user.id,
    username: session.user.name ?? "",
    action: "payments.requisite.create",
    target: created.name,
    targetId: created.id,
    details: `${ownerId ? "личный" : "общий"} шаблон, ${scope}${copiedFrom ? ` · копия «${copiedFrom}»` : ""}`,
  });

  return NextResponse.json({ requisite: toDto(created, session.user.id) });
}
