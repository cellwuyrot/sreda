import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { loadProjectAccess } from "@/lib/projectBusiness";

/**
 * BUSINESS-CABINET: история этапов и событий проекта.
 * Видна и партнёру-владельцу, и сотрудникам: это и есть закреплённая на сервере
 * версия того, что раньше жило только в переписке делового чата.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await loadProjectAccess({ projectId: id, userId: session.user.id, role: session.user.role });
  if (!access) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  const limitRaw = Number(new URL(req.url).searchParams.get("limit") || "100");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100;

  const events = await prisma.projectEvent.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ events, isStaff: access.isStaff });
}
