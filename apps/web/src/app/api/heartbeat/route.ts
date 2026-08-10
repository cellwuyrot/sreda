import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { showOnline: true },
  });

  if (user?.showOnline !== false) {
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeen: new Date() },
    });
  }

  return NextResponse.json({ ok: true, visible: user?.showOnline !== false });
}
