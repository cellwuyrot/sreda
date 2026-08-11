import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { normalizeDoneStages, stageProgress, stagesForService } from "@/lib/orderStages";

/**
 * ARCHIVE: выгрузка проекта одним файлом — GET /api/projects/<id>/export
 *
 * Архив в проекте означает копию на устройстве человека, а не ещё один список
 * на сервере. Поэтому здесь собирается всё, что нужно, чтобы понять состояние
 * заявки без доступа к сайту: назначение, домен, услуга, полный набор этапов с
 * отметками выполнения, опись материалов и переписка по проекту.
 *
 * Чего выгрузка НЕ делает:
 *
 *   • не кладёт внутрь сами материалы — только адреса, имена и размеры. Проект
 *     с макетами и видео весит гигабайты, и один такой ответ просто не дойдёт;
 *   • не удаляет и не меняет ничего на сервере. Проект ведёт администрация, и
 *     уборка его из своего списка не должна касаться чужой работы.
 *
 * Кто может выгружать: владелец проекта, а также ADMIN и EDITOR — те же права,
 * что и у обычного просмотра карточки в /api/projects/[id].
 */

const SERVICE_SELECT = { id: true, title: true, icon: true, stages: true } as const;

/** Материал в выгрузке: опись, а не сам файл. */
interface ExportedFile {
  url: string;
  name: string;
  size: number | null;
}

function describeFiles(value: unknown): ExportedFile[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => {
    const f = (item ?? {}) as Record<string, unknown>;
    const size = Number(f.size);
    return {
      url: typeof f.url === "string" ? f.url : "",
      name: typeof f.name === "string" ? f.name : "",
      size: Number.isFinite(size) ? size : null,
    };
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;

  const project = await prisma.partnerProject.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, username: true } },
      service: { select: SERVICE_SELECT },
    },
  });
  if (!project) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  const isStaff = session.user.role === "ADMIN" || session.user.role === "EDITOR";
  if (!isStaff && project.ownerId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /* Этапы приводятся к набору услуги ровно так же, как в кабинете: иначе в
     выгрузке остались бы галочки на шагах, которые администратор давно убрал
     из набора, и процент не сошёлся бы с тем, что человек видел на экране. */
  const stages = stagesForService(project.service);
  const done = normalizeDoneStages(project.stepsDone, stages);

  /* Переписка по проекту от старых сообщений к новым — читать выгрузку будут
     сверху вниз. Предел защищает память: ответ собирается целиком в памяти. */
  const LIMIT = 5_000;
  const messages = await prisma.partnerProjectMessage.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
    include: { author: { select: { id: true, name: true, username: true } } },
  });

  return NextResponse.json({
    format: "trioz-project-archive",
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: { id: userId, name: session.user.name ?? "" },
    project: {
      id: project.id,
      name: project.name,
      purpose: project.purpose,
      domain: project.domain,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      owner: project.owner,
      service: project.service
        ? { id: project.service.id, title: project.service.title, icon: project.service.icon }
        : null,
      progress: stageProgress(done, stages),
      /* Этапы отдаём полным набором с признаком выполнения, а не одним списком
         выполненных: без остальных шагов непонятно, сколько работы впереди. */
      stages: stages.map((stage) => ({
        id: stage.id,
        title: stage.title,
        done: done.includes(stage.id),
      })),
      files: describeFiles(project.files),
    },
    messageCount: messages.length,
    /* Честно говорим, что выгрузка оборвана: молчаливо отданный кусок человек
       примет за полную копию. */
    truncated: messages.length >= LIMIT,
    messages: messages.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      isStaff: m.isStaff,
      author: { id: m.author.id, name: m.author.name, username: m.author.username },
      text: m.body,
    })),
  });
}
