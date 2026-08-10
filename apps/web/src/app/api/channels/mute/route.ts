import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// GET — fetch mute status for all channels in a group + group mute
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
    select: { muted: true },
  });

  const channelMutes = await prisma.channelMute.findMany({
    where: {
      userId: session.user.id,
      channel: { groupId },
    },
    select: { channelId: true, muted: true },
  });

  return NextResponse.json({
    groupMuted: membership?.muted ?? false,
    channels: Object.fromEntries(channelMutes.map((cm) => [cm.channelId, cm.muted])),
  });
}

// POST — toggle mute for group or channel
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { groupId, channelId, muted } = await req.json();

  if (typeof muted !== "boolean") {
    return NextResponse.json({ error: "muted (boolean) required" }, { status: 400 });
  }

  // Mute/unmute group
  if (groupId && !channelId) {
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId } },
    });
    if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    await prisma.groupMember.update({
      where: { id: membership.id },
      data: { muted },
    });

    return NextResponse.json({ groupMuted: muted });
  }

  // Mute/unmute channel
  if (channelId) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { groupId: true } });
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId: channel.groupId } },
    });
    if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    await prisma.channelMute.upsert({
      where: { userId_channelId: { userId: session.user.id, channelId } },
      update: { muted },
      create: { userId: session.user.id, channelId, muted },
    });

    return NextResponse.json({ channelId, muted });
  }

  return NextResponse.json({ error: "groupId or channelId required" }, { status: 400 });
}
