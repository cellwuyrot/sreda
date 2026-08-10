import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logGroupAction } from "@/lib/groupAudit";
import { rankOf, RANK_MODERATOR } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

/**
 * MODERATION: разбор жалобы.
 *
 * PATCH /api/groups/[id]/reports/[reportId]
 * Body: { status: "RESOLVED" | "DISMISSED" }
 *
 * Меры к нарушителю принимаются обычными маршрутами (бан, тайм-аут, удаление);
 * здесь только закрывается карточка. Разделение намеренное: одна жалоба может
 * кончиться и баном, и ничем, а очередь должна пустеть в обоих случаях.
 */

const FINAL = new Set(["RESOLVED", "DISMISSED"]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; reportId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать закрывать жалобы в модерации группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id, reportId } = await params;
  const body = await req.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : null;

  if (!status || !FINAL.has(status)) {
    return NextResponse.json({ error: "status должен быть RESOLVED или DISMISSED" }, { status: 400 });
  }

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
    select: { role: true },
  });
  if (rankOf(membership?.role) < RANK_MODERATOR) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const report = await prisma.groupReport.findUnique({
    where: { id: reportId },
    include: { target: { select: { id: true, name: true, username: true } } },
  });
  if (!report || report.groupId !== id) {
    return NextResponse.json({ error: "Жалоба не найдена" }, { status: 404 });
  }

  const updated = await prisma.groupReport.update({
    where: { id: reportId },
    data: { status, handledById: session.user.id, handledAt: new Date() },
  });

  await logGroupAction({
    groupId: id,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "user",
    action: status === "RESOLVED" ? "report.resolve" : "report.dismiss",
    targetId: report.target.id,
    targetName: report.target.username || report.target.name,
    details: report.excerpt ? `Жалоба: «${report.excerpt.slice(0, 120)}»` : `Жалоба: ${report.reason}`,
  });

  return NextResponse.json({ ok: true, report: updated });
}
