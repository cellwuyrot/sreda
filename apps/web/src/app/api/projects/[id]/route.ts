import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createNotification } from "@/lib/createNotification";
import { normalizeDoneStages, stageProgress, stagesForService } from "@/lib/orderStages";
import { parseDate, recordProjectEvent } from "@/lib/projectBusiness"; // BUSINESS-CABINET
import { isStaffRole } from "@/lib/roles"; // ROLE-CORE
import { logAction } from "@/lib/audit";

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
      // BUSINESS-CABINET: ответственный нужен и клиенту: он видит, с кем имеет дело.
      responsible: { select: { id: true, name: true, username: true } },
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
  /* BUSINESS-CABINET: тело запроса читается ОДИН раз. Раньше req.json()
     вызывался прямо в выражении, и второе поле в тело было не добавить:
     повторное чтение потока запроса в Next.js падает. */
  const body = (await req.json().catch(() => null)) as
    | { steps?: unknown; dueDate?: unknown; responsible?: unknown }
    | null;
  const requested = toStageIds(body?.steps).filter((stageId) => known.has(stageId));

  // FIX-CABINET: только объединение — попытка отката игнорируется/отклоняется.
  const mergedSet = new Set([...done, ...requested]);
  const stageChanged = mergedSet.size !== done.length;

  /* BUSINESS-CABINET: срок сдачи. null — снять, строка-дата — выставить. */
  const parsedDue = parseDate(body?.dueDate);
  if (parsedDue === "invalid") {
    return NextResponse.json({ error: "Некорректная дата срока" }, { status: 400 });
  }

  /* Ответственный: "self" — взять проект на себя, null — снять. Назначать
     друг друга по идентификатору сознательно нельзя: иначе через это поле можно
     было бы перебирать и проверять чужие идентификаторы пользователей. */
  const responsibleRaw = body?.responsible;
  let responsibleId: string | null | undefined;
  if (responsibleRaw === "self") responsibleId = session.user.id;
  else if (responsibleRaw === null) responsibleId = null;
  else if (responsibleRaw !== undefined) {
    return NextResponse.json({ error: "Некорректный ответственный" }, { status: 400 });
  }

  if (!stageChanged && parsedDue === undefined && responsibleId === undefined) {
    return NextResponse.json({ error: "Не передано ни одного изменения" }, { status: 400 });
  }
  /* Порядок хранения — порядок набора: так список в кабинете и в админке
     совпадают без сортировки на каждой отрисовке. */
  const merged = stages.filter((stage) => mergedSet.has(stage.id)).map((stage) => stage.id);

  const progress = stageProgress(merged, stages);
  const status = progress >= 100 ? "LAUNCHED" : merged.length > 0 ? "IN_PROGRESS" : project.status;

  const updated = await prisma.partnerProject.update({
    where: { id },
    data: {
      stepsDone: merged,
      status,
      ...(parsedDue !== undefined ? { dueDate: parsedDue } : {}),
      ...(responsibleId !== undefined ? { responsibleId } : {}),
    },
    include: {
      owner: { select: { id: true, name: true, username: true, avatar: true } },
      service: { select: SERVICE_SELECT },
      responsible: { select: { id: true, name: true, username: true } },
    },
  });

  /* BUSINESS-CABINET: история этапов и сроков. До этого «что и когда сделали»
     существовало только в виде сообщений в деловом чате. */
  const actorName = session.user.name || session.user.username || "сотрудник";
  if (stageChanged) {
    const addedTitles = stages
      .filter((stage) => mergedSet.has(stage.id) && !done.includes(stage.id))
      .map((stage) => stage.title);
    await recordProjectEvent({
      projectId: id,
      kind: "STAGE_DONE",
      title: `Выполнено: ${addedTitles.join(", ").slice(0, 150) || "этап"}`,
      details: `Готовность проекта — ${progress}%`,
      actorId: session.user.id,
      actorName,
    });
  }
  if (parsedDue !== undefined) {
    const dueText = parsedDue ? parsedDue.toISOString().slice(0, 10) : null;
    await recordProjectEvent({
      projectId: id,
      kind: "DUE_DATE",
      title: dueText ? `Срок сдачи: ${dueText}` : "Срок сдачи снят",
      actorId: session.user.id,
      actorName,
    });
    if (project.ownerId !== session.user.id) {
      await createNotification({
        userId: project.ownerId,
        type: "project",
        title: dueText ? "Назначен срок по проекту" : "Срок по проекту снят",
        body: dueText ? `«${project.name}»: до ${dueText}` : `«${project.name}»`,
        link: "/partner",
      }).catch(() => {});
    }
  }
  if (responsibleId !== undefined) {
    await recordProjectEvent({
      projectId: id,
      kind: "RESPONSIBLE",
      title: responsibleId ? `Ответственный: ${actorName}` : "Ответственный снят",
      actorId: session.user.id,
      actorName,
    });
  }

  if (stageChanged && project.ownerId !== session.user.id) {
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

// ROLE-STRUCT: безвозвратное удаление проекта (ADMIN и EDITOR).
//
// Каскадом уйдут сообщения, счета, документы и история проекта — именно этого
// ожидает кнопка «удалить безвозвратно» в панели. Файлы с диска не трогаем:
// они лежат в закрытой папке и могут быть приложены к бухгалтерским документам.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStaffRole(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const project = await prisma.partnerProject.findUnique({
    where: { id },
    select: { id: true, name: true, ownerId: true },
  });
  if (!project) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  await prisma.partnerProject.delete({ where: { id } });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "staff",
    action: "delete",
    target: "PartnerProject",
    targetId: id,
    details: `Безвозвратное удаление проекта «${project.name}»`,
  });

  return NextResponse.json({ success: true });
}
