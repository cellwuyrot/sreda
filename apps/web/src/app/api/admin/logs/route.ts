import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { projectAuditWhere } from "@/lib/projectAudit";
import { ADMIN_PAGE_SIZE, positiveInteger } from "@/lib/adminPagination";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const requestedPage = positiveInteger(searchParams.get("page"), 1);
  const limit = ADMIN_PAGE_SIZE;
  const action = searchParams.get("action");
  const userId = searchParams.get("userId");

  const where = projectAuditWhere();
  if (action) where.action = action;
  if (userId) where.userId = userId;

  // ROLE-STRUCT: журнал целиком — сведения уровня проекта (кто банил, кто менял
  // оплаты, какие действия вёл админ). Редактору оставляем только его
  // собственные записи: работу проверить можно, слежку за коллегами — нет.
  // Фильтр выставляем ПОСЛЕ разбора query, чтобы ?userId= его не обошёл.
  if (session.user.role !== "ADMIN") where.userId = session.user.id;

  const total = await prisma.auditLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, pages);
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
  });
  return NextResponse.json({ logs, total, page, pages, limit }, { headers: { "Cache-Control": "private, no-store" } });
}
