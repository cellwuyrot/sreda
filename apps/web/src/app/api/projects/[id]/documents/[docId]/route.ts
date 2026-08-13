import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { loadProjectAccess, recordProjectEvent } from "@/lib/projectBusiness";

/**
 * BUSINESS-CABINET: убрать документ из карточки проекта (только сотрудник).
 *
 * Сам файл остаётся в закрытом хранилище: договор мог быть подписан, и тихое
 * уничтожение бухгалтерского документа одной кнопкой было бы ошибкой.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, docId } = await params;

  const access = await loadProjectAccess({ projectId: id, userId: session.user.id, role: session.user.role });
  if (!access) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  if (!access.isStaff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const document = await prisma.projectDocument.findFirst({ where: { id: docId, projectId: id } });
  if (!document) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });

  await prisma.projectDocument.delete({ where: { id: docId } });

  await recordProjectEvent({
    projectId: id,
    kind: "DOCUMENT_REMOVED",
    title: `Убран документ: ${document.name}`,
    actorId: session.user.id,
    actorName: session.user.name || session.user.username || "сотрудник",
  });

  return NextResponse.json({ success: true });
}
