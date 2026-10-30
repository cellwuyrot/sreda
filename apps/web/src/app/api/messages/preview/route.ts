import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { businessAudience, isStaffRole } from "@/lib/businessChat";
import { emitToChannel, emitToUser } from "@/lib/socketEmit";
import { tzIdSameOrigin } from "@/lib/tzIdOrigin";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { previewIdentity } from "@/lib/linkPreviewPolicy";

async function target(
  scope: string,
  id: string,
  viewer: { id: string; role?: string | null },
) {
  if (scope === "channel") {
    const m = await prisma.message.findUnique({ where: { id } });
    if (!m || m.deleted) return null;
    const p = await getChannelPermissions(viewer.id, m.channelId);
    if (!p?.canView) return null;
    return {
      author: m.userId,
      suppressed: m.previewSuppressed,
      canChange: !!p.canPost,
      channelId: m.channelId,
      conversation: null,
      secure: false,
    };
  }
  const m = await prisma.directMessage.findUnique({ where: { id } });
  if (!m || m.deleted) return null;
  const c = await prisma.directConversation.findUnique({
    where: { id: m.conversationId },
  });
  if (
    !c ||
    !(
      c.user1Id === viewer.id ||
      c.user2Id === viewer.id ||
      (c.kind === "BUSINESS" && isStaffRole(viewer.role))
    )
  )
    return null;
  return {
    author: m.userId,
    suppressed: m.previewSuppressed,
    canChange: !(
      c.kind === "BUSINESS" &&
      c.locked &&
      !isStaffRole(viewer.role)
    ),
    channelId: null,
    conversation: c,
    secure: c.kind === "SECURE" || m.encrypted,
  };
}
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(req: NextRequest) {
  const s = await getServerSession(authOptions);
  if (!s?.user) return json({ error: "Unauthorized" }, 401);
  const scope = req.nextUrl.searchParams.get("scope") || "",
    messageId = req.nextUrl.searchParams.get("messageId") || "";
  if (!previewIdentity(scope, messageId))
    return json({ error: "Invalid message" }, 400);
  const t = await target(scope, messageId, s.user);
  if (!t) return json({ error: "Not found" }, 404);
  const own = await prisma.chatLinkPreviewHidden.findUnique({
    where: { userId_scope_messageId: { userId: s.user.id, scope, messageId } },
  });
  return json({
    hidden: !!own,
    suppressed: t.suppressed || t.secure,
    canSuppress: t.author === s.user.id && t.canChange && !t.secure,
  });
}
export async function POST(req: NextRequest) {
  const s = await getServerSession(authOptions);
  if (!s?.user) return json({ error: "Unauthorized" }, 401);
  if (!tzIdSameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const banned = await checkBan(s.user.id);
  if (banned) return banned;
  const limited = await rateLimit(req, "message-preview", {
    limit: 60,
    windowMs: 60000,
  });
  if (limited) return limited;
  const b = await req.json().catch(() => null);
  if (
    !b ||
    !previewIdentity(b.scope, b.messageId) ||
    typeof b.value !== "boolean" ||
    !["personal", "author"].includes(b.action)
  )
    return json({ error: "Invalid preference" }, 400);
  const t = await target(b.scope, b.messageId, s.user);
  if (!t) return json({ error: "Not found" }, 404);
  const key = { userId: s.user.id, scope: b.scope, messageId: b.messageId };
  if (b.action === "personal") {
    if (b.value)
      await prisma.chatLinkPreviewHidden.upsert({
        where: { userId_scope_messageId: key },
        create: key,
        update: {},
      });
    else await prisma.chatLinkPreviewHidden.deleteMany({ where: key });
    emitToUser(s.user.id, "link-preview-state", {
      scope: b.scope,
      id: b.messageId,
      hidden: b.value,
    });
    return json({ hidden: b.value });
  }
  if (t.author !== s.user.id || !t.canChange || t.secure)
    return json({ error: "Forbidden" }, 403);
  // updateMany prevents a concurrently deleted message from being changed.
  const where = { id: b.messageId, userId: s.user.id, deleted: false };
  const result =
    b.scope === "channel"
      ? await prisma.message.updateMany({
          where,
          data: { previewSuppressed: b.value },
        })
      : await prisma.directMessage.updateMany({
          where,
          data: { previewSuppressed: b.value },
        });
  if (!result.count) return json({ error: "Message changed" }, 409);
  const payload = { scope: b.scope, id: b.messageId, suppressed: b.value };
  if (t.channelId) emitToChannel(t.channelId, "link-preview-state", payload);
  else if (t.conversation) {
    const c = t.conversation;
    const audience =
      c.kind === "BUSINESS"
        ? await businessAudience(c)
        : [c.user1Id, c.user2Id];
    for (const id of new Set(audience))
      emitToUser(id, "link-preview-state", payload);
  }
  return json({ suppressed: b.value });
}
