import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // FIX-SEC-EXPOSURE: PII и детали бана (email, banReason, bannedUntil) видит
  // только ADMIN. EDITOR получает статус `banned` (для плашек в панели), но не
  // персональные данные и не внутренние причины/сроки бана.
  const isAdmin = session.user.role === "ADMIN";

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      username: true,
      avatar: true,
      role: true,
      isPremium: true,
      banned: true,
      lastSeen: true,
      createdAt: true,
      _count: { select: { messages: true } },
      ...(isAdmin ? { email: true, banReason: true, bannedUntil: true } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(users);
}
