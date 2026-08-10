import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// FIX-ADM2: активность пользователя для админ-панели —
// активные сессии, последние входы, IP устройств, последние действия
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  // FIX-EDR: сессии активности, входы и IP видит только ADMIN
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const [activeSessions, logins, allSessions, actions] = await Promise.all([
    prisma.userSession.findMany({
      where: { userId: id, active: true },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsed: true },
      orderBy: { lastUsed: "desc" },
      take: 20,
    }),
    prisma.userSession.findMany({
      where: { userId: id },
      select: { id: true, ip: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.userSession.findMany({
      where: { userId: id, ip: { not: null } },
      select: { ip: true, lastUsed: true },
      orderBy: { lastUsed: "desc" },
      take: 200,
    }),
    prisma.auditLog.findMany({
      where: { userId: id },
      select: { id: true, action: true, target: true, details: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

  // Уникальные IP с количеством сессий и последним использованием
  const ipMap = new Map<string, { ip: string; count: number; lastUsed: Date }>();
  for (const s of allSessions) {
    if (!s.ip) continue;
    const entry = ipMap.get(s.ip);
    if (entry) {
      entry.count += 1;
      if (s.lastUsed > entry.lastUsed) entry.lastUsed = s.lastUsed;
    } else {
      ipMap.set(s.ip, { ip: s.ip, count: 1, lastUsed: s.lastUsed });
    }
  }

  return NextResponse.json({
    activeSessions,
    logins,
    ips: Array.from(ipMap.values()).sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime()),
    actions,
  });
}
