import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  MAX_STAGES,
  defaultStagesForService,
  sanitizeStages,
  stagesForService,
} from "@/lib/orderStages";

/**
 * STAGES: редактор этапов работ по услуге (шестерёнка в /admin/services).
 *
 *   GET    — текущий набор, каталожный набор и признак «правили ли его»;
 *   PUT    — сохранить свой набор услуги;
 *   DELETE — сбросить к каталожному набору.
 *
 * Правит только администрация: этапы видит каждый заказчик в своём кабинете, и
 * это, по сути, публичное обещание о ходе работ.
 *
 * Набор ВСЕГДА возвращается непустым — даже у услуги, которую никто не
 * настраивал. Пустота в кабинете читалась бы как «по вашему заказу ничего не
 * происходит».
 */

function staffOnly(role: string | undefined): boolean {
  return role === "ADMIN" || role === "EDITOR";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staffOnly(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const service = await prisma.service.findUnique({
    where: { id },
    select: { id: true, title: true, stages: true },
  });
  if (!service) return NextResponse.json({ error: "Услуга не найдена" }, { status: 404 });

  return NextResponse.json({
    stages: stagesForService(service),
    /* Каталожный набор нужен кнопке «Сбросить»: она обязана показать, к чему
       именно вернётся список, ещё до нажатия. */
    defaults: defaultStagesForService(service.title),
    custom: sanitizeStages(service.stages) !== null,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staffOnly(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!service) return NextResponse.json({ error: "Услуга не найдена" }, { status: 404 });

  const data = await req.json().catch(() => null);
  const raw = (data as { stages?: unknown } | null)?.stages;
  if (Array.isArray(raw) && raw.length > MAX_STAGES) {
    return NextResponse.json({ error: `Не более ${MAX_STAGES} этапов` }, { status: 400 });
  }

  /* Идентификаторы новым этапам присваивает сервер, а не редактор: два
     администратора, добавившие шаг одновременно, выдали бы один и тот же номер,
     и отметки проектов слиплись бы. */
  const stages = sanitizeStages(raw);
  if (!stages) {
    return NextResponse.json({ error: "Нужен хотя бы один этап" }, { status: 400 });
  }

  const updated = await prisma.service.update({
    where: { id },
    data: { stages },
    select: { id: true, title: true, stages: true },
  });

  return NextResponse.json({
    stages: stagesForService(updated),
    defaults: defaultStagesForService(updated.title),
    custom: true,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staffOnly(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!service) return NextResponse.json({ error: "Услуга не найдена" }, { status: 404 });

  /* Сброс — это именно NULL (Prisma.DbNull), а не копия каталожного набора.
     Копия застыла бы: поправили формулировку в каталоге — у услуги остался бы
     старый текст, и никто бы не понял, почему. */
  await prisma.service.update({ where: { id }, data: { stages: Prisma.DbNull } });

  const defaults = defaultStagesForService(service.title);
  return NextResponse.json({ stages: defaults, defaults, custom: false });
}
