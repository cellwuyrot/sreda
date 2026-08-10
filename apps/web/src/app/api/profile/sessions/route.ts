import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// FIX-SEC-EXPOSURE: не отдаём полный IP даже владельцу сессий — маскируем
// последний октет (IPv4) / хвост (IPv6). Достаточно для распознавания «свой/чужой
// вход», но не раскрывает полный список адресов (VPN-эндпоинты и т.п.).
function maskIp(ip: string | null): string | null {
  if (!ip) return ip;
  if (ip.includes(".")) return ip.replace(/\.\d+$/, ".***");
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return parts.slice(0, 3).join(":") + ":***";
  }
  return "***";
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await prisma.userSession.findMany({
    where: { userId: session.user.id, active: true },
    select: { id: true, userAgent: true, ip: true, lastUsed: true, createdAt: true },
    orderBy: { lastUsed: "desc" },
  });

  return NextResponse.json(sessions.map((s) => ({ ...s, ip: maskIp(s.ip) })));
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");

  if (sessionId) {
    // Terminate specific session
    const target = await prisma.userSession.findUnique({ where: { id: sessionId } });
    if (!target || target.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.userSession.update({ where: { id: sessionId }, data: { active: false } });
  } else {
    // Terminate all other sessions (keep current)
    await prisma.userSession.updateMany({
      where: { userId: session.user.id, active: true },
      data: { active: false },
    });
  }

  return NextResponse.json({ ok: true });
}
