import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createNotification } from "@/lib/createNotification";
import { normalizeDoneStages, stageProgress, stagesForService } from "@/lib/orderStages";

// FIX-CABINET: карточка проекта личного кабинета.
// GET   /api/projects/[id] — владелец проекта или ADMIN/EDITOR.
// PATCH /api/projects/[id] { steps: string[] } — только ADMIN/EDITOR.
//   Этапы необратимы: новые идентификаторы объединяются с уже выполненными,
//   снять выполненный этап нельзя — процент только растёт.
//
// STAGES: в теле приходят ИДЕНТИФИКАТОРЫ этапов, а не номера. Номер жил ровно
// до первой правки набора: удалили шаг — и все следующие съехали, у проекта
// оказались отмечены не те работы.

const SERVICE_SELECT = { id: true, title: true, icon: true, stages: true } as const;

/** Только строки: номера пунктов больше не принимаются от клиента. */
function toStageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((s): s is string => typeof s === "string" && s.length > 0))];
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const project = await prisma.partnerProject.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, username: true, avatar: true } },
      service: { select: SERVICE_SELECT },
    },
  });
  if (!project) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  const isStaff = session.user.role === "ADMIN" || session.user.role === "EDITOR";
  if (!isStaff && project.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ project, isStaff, stages: stagesForService(project.service) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const project = await prisma.partnerProject.findUnique({
    where: { id },
    include: { service: { select: SERVICE_SELECT } },
  });
  if (!project) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  /* Набор берётся из услуги проекта. Чужой идентификатор сюда прислать можно —
     он просто отсеется: отмечать этап, которого в наборе нет, значит показать
     заказчику прогресс по несуществующей работе. */
  const stages = stagesForService(project.service);
  const done = normalizeDoneStages(project.stepsDone, stages);
  const known = new Set(stages.map((stage) => stage.id));
  const requested = toStageIds((await req.json().catch(() => null) as { steps?: unknown } | null)?.steps)
    .filter((stageId) => known.has(stageId));

  // FIX-CABINET: только объединение — попытка отката игнорируется/отклоняется.
  const mergedSet = new Set([...done, ...requested]);
  if (mergedSet.size === done.length) {
    return NextResponse.json({ error: "Не передано ни одного нового этапа" }, { status: 400 });
  }
  /* Порядок хранения — порядок набора: так список в кабинете и в админке
     совпадают без сортировки на каждой отрисовке. */
  const merged = stages.filter((stage) => mergedSet.has(stage.id)).map((stage) => stage.id);

  const progress = stageProgress(merged, stages);
  const status = progress >= 100 ? "LAUNCHED" : merged.length > 0 ? "IN_PROGRESS" : project.status;

  const updated = await prisma.partnerProject.update({
    where: { id },
    data: { stepsDone: merged, status },
    include: {
      owner: { select: { id: true, name: true, username: true, avatar: true } },
      service: { select: SERVICE_SELECT },
    },
  });

  if (project.ownerId !== session.user.id) {
    await createNotification({
      userId: project.ownerId,
      type: "project",
      title: progress >= 100 ? "Работы по проекту завершены" : "Прогресс проекта обновлён",
      body: `«${project.name}»: готово на ${progress}%`,
      link: "/partner",
    }).catch(() => {});
  }

  return NextResponse.json({ project: updated, isStaff: true, stages });
}
