import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { channelIds, groupId } = await req.json();
    if (!Array.isArray(channelIds) || !groupId) {
      return NextResponse.json({ error: "channelIds array and groupId required" }, { status: 400 });
    }

    const member = await prisma.groupMember.findFirst({
      where: { userId: session.user.id, groupId },
    });
    if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // FIX-SEC-IDOR: раньше channel.update шёл по голому id без привязки к группе —
    // владелец группы A мог переупорядочить каналы группы B. updateMany с
    // where {id, groupId} гарантирует, что затрагиваются только каналы этой
    // группы (чужие id молча игнорируются). Плюс потолок на размер массива.
    const safeIds = channelIds.slice(0, 500);
    const updates = safeIds.map((id: string, index: number) =>
      prisma.channel.updateMany({
        where: { id, groupId },
        data: { sortOrder: index },
      })
    );

    await prisma.$transaction(updates);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to reorder" }, { status: 500 });
  }
}
