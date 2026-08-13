import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminRole, isStaffRole } from "@/lib/roles";

/**
 * ROLE-STRUCT: сводка для «Редакторской».
 *
 * Раньше роут отдавал ПОЛНЫЕ списки пользователей (с email-адресами, датами
 * последнего визита и счётчиками сообщений), услуг, экосистемы и общий журнал
 * действий — при том, что странице нужны только числа на плитках. Это была
 * выгрузка базы посетителей по адресу, открытому редактору. Теперь возвращаются
 * агрегаты, а журнал — только собственные действия (у админа — общий).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isStaffRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const online = new Date(Date.now() - 60_000);
  const [users, onlineUsers, bannedUsers, services, activeServices, ecosystem, openAppeals, activeProjects, logs] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { lastSeen: { gte: online } } }),
      prisma.user.count({ where: { banned: true } }),
      prisma.service.count(),
      prisma.service.count({ where: { active: true } }),
      prisma.ecosystemItem.count(),
      prisma.appeal.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      prisma.partnerProject.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] } } }),
      prisma.auditLog.findMany({
        where: isAdminRole(session.user.role) ? {} : { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          username: true,
          action: true,
          target: true,
          targetId: true,
          details: true,
          createdAt: true,
        },
      }),
    ]);

  return NextResponse.json({
    stats: {
      users,
      onlineUsers,
      bannedUsers,
      services,
      activeServices,
      ecosystem,
      openAppeals,
      activeProjects,
    },
    logs,
  });
}
