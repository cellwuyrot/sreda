import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { freshActivity } from "@/lib/activity"; // FIX-ACT
import { resolveProfileBanner } from "@/lib/profileBannerFallback"; // FIX-BANNERWEB

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const username = req.nextUrl.searchParams.get("username");
  if (!username) return NextResponse.json({ error: "Username required" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      name: true,
      username: true,
      avatar: true,
      role: true,
      bio: true,
      socialLinks: true,
      customStatus: true,
      statusEmoji: true,
      activityStatus: true, // FIX-ACT
      activityUpdatedAt: true, // FIX-ACT
        privacyOnline: true,
        showOnline: true,
        privacyEmail: true,

      avatarGlowEnabled: true,
      avatarGlowColors: true,
      profileBanner: true,
      lastSeen: true,
      createdAt: true,
      _count: {
        select: {
          messages: true,
          friendsSent: { where: { status: "ACCEPTED" } },
          friendsReceived: { where: { status: "ACCEPTED" } },
          gamePlayers: true,
        },
      },
      badges: {
        include: { badge: true },
        orderBy: { awardedAt: "desc" },
      },
      groupMembers: {
        select: { group: { select: { id: true, name: true, icon: true } } },
      },
    },
  });

  if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  // Check if viewer is friends with this user
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { senderId: session.user.id, receiverId: user.id },
        { senderId: user.id, receiverId: session.user.id },
      ],
    },
  });

  // Check pending friend request
  const pendingRequest = await prisma.friendship.findFirst({
    where: {
      status: "PENDING",
      OR: [
        { senderId: session.user.id, receiverId: user.id },
        { senderId: user.id, receiverId: session.user.id },
      ],
    },
    select: { id: true, senderId: true, status: true },
  });

  // Find common groups
  const viewerGroups = await prisma.groupMember.findMany({
    where: { userId: session.user.id },
    select: { groupId: true },
  });
  const viewerGroupIds = new Set(viewerGroups.map((g) => g.groupId));
  const commonGroups = user.groupMembers
    .filter((gm) => viewerGroupIds.has(gm.group.id))
    .map((gm) => gm.group);

  // Apply privacy settings
  const isSelf = user.id === session.user.id;
  const isFriend = !!friendship;

  let showOnline = user.showOnline;
  if (!isSelf) {
    if (user.privacyOnline === "friends" && !isFriend) showOnline = false;
    if (user.privacyOnline === "nobody") showOnline = false;
  }

  const friendCount = user._count.friendsSent + user._count.friendsReceived;

  return NextResponse.json({
    id: user.id,
    name: user.name,
    username: user.username,
    avatar: user.avatar,
    role: user.role,
    bio: user.bio,
    socialLinks: user.socialLinks ? JSON.parse(user.socialLinks) : null,
    // FIX-ACT: если ручного статуса нет — показываем свежую активность с ПК
    customStatus: user.customStatus ?? freshActivity(user),
    statusEmoji: user.statusEmoji,
    avatarGlowEnabled: user.avatarGlowEnabled,
    avatarGlowColors: user.avatarGlowColors,
    // FIX-BANNERWEB: пустое поле добираем прежним фоном из профиля сообщества.
    profileBanner: await resolveProfileBanner(user.id, user.profileBanner),
    lastSeen: showOnline ? user.lastSeen : null,
    showOnline,
    createdAt: user.createdAt,
    stats: {
      messages: user._count.messages,
      friends: friendCount,
      games: user._count.gamePlayers,
    },
    badges: user.badges.map((ub) => ({
      id: ub.badge.id,
      name: ub.badge.name,
      description: ub.badge.description,
      icon: ub.badge.icon,
      imageUrl: ub.badge.imageUrl,
      rarity: ub.badge.rarity,
      awardedAt: ub.awardedAt,
    })),
    commonGroups,
    isFriend,
    isSelf,
    pendingRequest: pendingRequest ? { id: pendingRequest.id, isSender: pendingRequest.senderId === session.user.id } : null,
  });
}
