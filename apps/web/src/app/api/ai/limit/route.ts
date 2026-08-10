import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

const UNLIMITED_ROLES = ["ADMIN", "EDITOR", "CONSULTANT"];
const DAILY_LIMIT = 10;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRole = (session.user as { role: string }).role;
  if (UNLIMITED_ROLES.includes(userRole)) {
    return NextResponse.json({ unlimited: true, used: 0, limit: null });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const used = await prisma.aiMessage.count({
    where: {
      role: "user",
      createdAt: { gte: startOfDay },
      chat: { userId: session.user.id },
    },
  });

  return NextResponse.json({
    unlimited: false,
    used,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - used),
  });
}
