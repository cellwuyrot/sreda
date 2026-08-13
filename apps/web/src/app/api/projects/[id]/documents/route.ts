import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createNotification } from "@/lib/createNotification";
import { rateLimit } from "@/lib/rateLimit";
import {
  DOCUMENT_KIND_LABEL,
  isDocumentKind,
  isProjectUploadUrl,
  loadProjectAccess,
  recordProjectEvent,
} from "@/lib/projectBusiness";

/**
 * BUSINESS-CABINET: документы и договоры по проекту.
 *
 * Файл сначала загружается через /api/projects/upload (там проверяются тип, размер
 * и пишется владелец вложения), а сюда приходит только ссылка. Поэтому ссылка
 * проверяется по форме: в базу не должен попасть произвольный адрес.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await loadProjectAccess({ projectId: id, userId: session.user.id, role: session.user.role });
  if (!access) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  const documents = await prisma.projectDocument.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ documents, isStaff: access.isStaff });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await loadProjectAccess({ projectId: id, userId: session.user.id, role: session.user.role });
  if (!access) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  if (!access.isStaff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limited = await rateLimit(req, `project-doc:${session.user.id}`, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as
    | { kind?: unknown; name?: unknown; url?: unknown; size?: unknown; mime?: unknown }
    | null;

  const kind = isDocumentKind(body?.kind) ? body.kind : "CONTRACT";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!name) return NextResponse.json({ error: "Укажите название документа" }, { status: 400 });
  if (!isProjectUploadUrl(body?.url)) {
    return NextResponse.json({ error: "Сначала загрузите файл документа" }, { status: 400 });
  }
  const size = typeof body?.size === "number" && body.size >= 0 ? Math.round(body.size) : 0;
  const mime = typeof body?.mime === "string" ? body.mime.slice(0, 120) : null;
  const uploadedByName = session.user.name || session.user.username || "сотрудник";

  const document = await prisma.projectDocument.create({
    data: {
      projectId: id,
      kind,
      name,
      url: body.url,
      size,
      mime,
      uploadedById: session.user.id,
      uploadedByName,
    },
  });

  await recordProjectEvent({
    projectId: id,
    kind: "DOCUMENT_ADDED",
    title: `${DOCUMENT_KIND_LABEL[kind]}: ${name}`,
    actorId: session.user.id,
    actorName: uploadedByName,
  });

  if (access.project.ownerId !== session.user.id) {
    await createNotification({
      userId: access.project.ownerId,
      type: "project",
      title: `Добавлен документ: ${DOCUMENT_KIND_LABEL[kind]}`,
      body: `«${access.project.name}»: ${name}`,
      link: "/partner",
    }).catch(() => {});
  }

  return NextResponse.json({ document });
}
