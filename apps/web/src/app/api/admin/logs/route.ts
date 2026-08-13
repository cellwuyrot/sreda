import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const action = searchParams.get("action");
  const userId = searchParams.get("userId");

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (userId) where.userId = userId;

  // ROLE-STRUCT: журнал целиком — сведения уровня проекта (кто банил, кто менял
  // оплаты, какие действия вёл админ). Редактору оставляем только его
  // собственные записи: работу проверить можно, слежку за коллегами — нет.
  // Фильтр выставляем ПОСЛЕ разбора query, чтобы ?userId= его не обошёл.
  if (session.user.role !== "ADMIN") where.userId = session.user.id;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, page, limit });
}
