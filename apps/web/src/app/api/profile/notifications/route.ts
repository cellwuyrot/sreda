import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { notifySound: true, notifyPush: true, notifyEmail: true, mutedGroups: true, mutedChannels: true },
  });

  return NextResponse.json({
    notifySound: user?.notifySound ?? true,
    notifyPush: user?.notifyPush ?? true,
    /* Письма по обращениям. Живут здесь, а не отдельным маршрутом: это такая же
       настройка уведомлений, и раздел «Уведомления» в админской читает её тем же
       запросом, что страница настроек — свои. */
    notifyEmail: user?.notifyEmail ?? true,
    mutedGroups: user?.mutedGroups ? JSON.parse(user.mutedGroups) : [],
    mutedChannels: user?.mutedChannels ? JSON.parse(user.mutedChannels) : [],
  });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.notifySound === "boolean") data.notifySound = body.notifySound;
  if (typeof body.notifyPush === "boolean") data.notifyPush = body.notifyPush;
  if (typeof body.notifyEmail === "boolean") data.notifyEmail = body.notifyEmail;

  if (Array.isArray(body.mutedGroups)) {
    data.mutedGroups = JSON.stringify(body.mutedGroups);
  }
  if (Array.isArray(body.mutedChannels)) {
    data.mutedChannels = JSON.stringify(body.mutedChannels);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No data to update" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { notifySound: true, notifyPush: true, notifyEmail: true, mutedGroups: true, mutedChannels: true },
  });

  return NextResponse.json({
    notifySound: updated.notifySound,
    notifyPush: updated.notifyPush,
    notifyEmail: updated.notifyEmail,
    mutedGroups: updated.mutedGroups ? JSON.parse(updated.mutedGroups) : [],
    mutedChannels: updated.mutedChannels ? JSON.parse(updated.mutedChannels) : [],
  });
}
