import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  await prisma.groupMember.update({
    where: { id: membership.id },
    data: { rulesAccepted: true },
  });

  return NextResponse.json({ ok: true });
}
