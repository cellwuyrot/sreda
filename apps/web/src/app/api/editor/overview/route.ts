import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

const ALLOWED_ROLES = new Set(["EDITOR", "ADMIN"]);

/**
 * Read-only editor workspace data. Mutating admin APIs remain ADMIN-only until
 * individual EDITOR permissions are explicitly approved.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !ALLOWED_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [users, services, ecosystem, logs] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        role: true,
        banned: true,
        lastSeen: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.service.findMany({ orderBy: { order: "asc" } }),
    prisma.ecosystemItem.findMany({ orderBy: [{ section: "asc" }, { order: "asc" }] }),
    prisma.auditLog.findMany({
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
      users: users.length,
      onlineUsers: users.filter((user) => user.lastSeen && Date.now() - user.lastSeen.getTime() < 60_000).length,
      bannedUsers: users.filter((user) => user.banned).length,
      services: services.length,
      activeServices: services.filter((service) => service.active).length,
      ecosystem: ecosystem.length,
    },
    users,
    services,
    ecosystem,
    logs,
  });
}
