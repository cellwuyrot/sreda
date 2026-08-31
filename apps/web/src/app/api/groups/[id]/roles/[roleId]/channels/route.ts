import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

type Ctx = { params: Promise<{ id: string; roleId: string }> };

async function checkAdmin(userId: string, groupId: string) {
  const m = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  return m && effectiveRank(m) >= ROLE_RANK.ADMIN;
}

/** GET — list channels linked to this role for moderation */
export async function GET(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, roleId } = await params;
  if (!(await checkAdmin(session.user.id, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const powers = await prisma.channelRolePower.findMany({
      where: { roleId },
      include: { channel: { select: { id: true, name: true, type: true } } },
    });
    return NextResponse.json(powers);
  } catch {
    return NextResponse.json([]);
  }
}

/** POST { channelId } — bind a channel to this role */
export async function POST(req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;
  const { id, roleId } = await params;
  if (!(await checkAdmin(session.user.id, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { channelId } = await req.json();
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });
  // verify channel belongs to this group
  const ch = await prisma.channel.findFirst({ where: { id: channelId, groupId: id } });
  if (!ch) return NextResponse.json({ error: "Channel not found in group" }, { status: 404 });
  const power = await prisma.channelRolePower.upsert({
    where: { roleId_channelId: { roleId, channelId } },
    create: { id: `${roleId}_${channelId}_${Date.now()}`.slice(0, 25), roleId, channelId },
    update: {},
  });
  return NextResponse.json(power);
}

/** DELETE ?channelId=xxx — unbind a channel */
export async function DELETE(req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;
  const { id, roleId } = await params;
  if (!(await checkAdmin(session.user.id, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const channelId = url.searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });
  try {
    await prisma.channelRolePower.delete({ where: { roleId_channelId: { roleId, channelId } } });
  } catch { /* already gone */ }
  return NextResponse.json({ ok: true });
}
