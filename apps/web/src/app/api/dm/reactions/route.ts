import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { emitToUser } from "@/lib/socketEmit";

/** Idempotent SET, not a toggle: repeating the same HTTP request never undoes it. */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "dm-reactions", { limit: 60, windowMs: 60000 });
  if (limited) return limited;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id); if (banned) return banned;
  const { messageId, emoji, active } = await req.json().catch(() => ({}));
  if (typeof messageId !== "string" || typeof emoji !== "string" || !emoji.trim() || emoji.length > 64 || /[\u0000-\u001f\u007f]/.test(emoji) || typeof active !== "boolean")
    return NextResponse.json({ error: "Некорректная реакция" }, { status: 400 });
  const message = await prisma.directMessage.findUnique({ where: { id: messageId }, include: { conversation: true } });
  if (!message || message.deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const conv = message.conversation;
  if (conv.user1Id !== session.user.id && conv.user2Id !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (conv.kind !== "PERSONAL") return NextResponse.json({ error: "Реакции доступны только в обычной личной переписке" }, { status: 400 });
  const userId = session.user.id;
  const peerId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;
  const blocked = await prisma.dmUserSetting.findFirst({ where: { blacklisted: true, OR: [{ ownerId: userId, targetId: peerId }, { ownerId: peerId, targetId: userId }] } });
  if (blocked) return NextResponse.json({ error: "Личные сообщения ограничены" }, { status: 403 });
  if (active) await prisma.directMessageReaction.upsert({ where: { messageId_userId_emoji: { messageId, userId, emoji } }, create: { messageId, userId, emoji }, update: {} });
  else await prisma.directMessageReaction.deleteMany({ where: { messageId, userId, emoji } });
  const reactions = await prisma.directMessageReaction.findMany({ where: { messageId }, include: { user: { select: { id: true, name: true, username: true } } } });
  for (const recipient of new Set([conv.user1Id, conv.user2Id])) emitToUser(recipient, active ? "dm-reaction-added" : "dm-reaction-removed", { conversationId: conv.id, messageId, emoji, userId, userName: session.user.name || "Участник" });
  return NextResponse.json({ reactions });
}
