import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { badgeId, userId } = await req.json();
  if (!badgeId || !userId) {
    return NextResponse.json({ error: "badgeId and userId required" }, { status: 400 });
  }

  const badge = await prisma.badge.findUnique({ where: { id: badgeId } });
  if (!badge) return NextResponse.json({ error: "Badge not found" }, { status: 404 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Check if already awarded
  const existing = await prisma.userBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId } },
  });
  if (existing) return NextResponse.json({ error: "Badge already awarded" }, { status: 409 });

  const userBadge = await prisma.userBadge.create({
    data: { userId, badgeId, awardedBy: session.user.id },
    include: { badge: true, user: { select: { id: true, name: true, username: true } } },
  });

  return NextResponse.json(userBadge, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const badgeId = searchParams.get("badgeId");
  const userId = searchParams.get("userId");
  if (!badgeId || !userId) {
    return NextResponse.json({ error: "badgeId and userId required" }, { status: 400 });
  }

  await prisma.userBadge.deleteMany({ where: { userId, badgeId } });
  return NextResponse.json({ ok: true });
}
