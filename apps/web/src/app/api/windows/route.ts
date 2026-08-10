import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";

export async function GET() {
  const windows = await prisma.windowConfig.findMany({
    where: { active: true },
    orderBy: { order: "asc" },
  });
  return NextResponse.json(windows);
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = await req.json();
  const { id, ...updateData } = data;
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const item = await prisma.windowConfig.update({
    where: { id },
    data: updateData,
  });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "WindowConfig",
    targetId: id,
    details: `Изменение окна "${item.title || id}"`,
  });

  return NextResponse.json(item);
}
