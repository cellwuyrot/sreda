import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logGroupAction } from "@/lib/groupAudit";
import { rateLimit } from "@/lib/rateLimit";
import { randomBytes } from "crypto";
import { checkBan } from "@/lib/banCheck";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать создавать приглашения в группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  // FIX-SEC-RL: ограничиваем создание приглашений (спам/перебор).
  const limited = await rateLimit(req, `invite-create:${session.user.id}`, { limit: 20, windowMs: 60 * 60_000 });
  if (limited) return limited;

  const { groupId, maxUses, expiresInHours, permanent } = await req.json();

  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });

  if (!membership || membership.role === "MEMBER") {
    return NextResponse.json({ error: "Need ADMIN or OWNER role to create invites" }, { status: 403 });
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, icon: true },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Параметры срока/лимита (постоянная = без срока и без лимита).
  const inviteHours =
    permanent === true
      ? null
      : typeof expiresInHours === "number" && expiresInHours > 0
        ? expiresInHours
        : null;
  const inviteMaxUses =
    permanent === true ? 0 : typeof maxUses === "number" && maxUses > 0 ? maxUses : 0;

  // FIX-INVITE-PERM: постоянная ссылка у сообщества ОДНА. Если активная
  // бессрочная безлимитная ссылка уже существует — идемпотентно возвращаем её,
  // а не создаём дубликат (кнопка «Пригласить» может вызываться многократно).
  if (inviteHours === null && inviteMaxUses === 0) {
    const existing = await prisma.invite.findFirst({
      where: { groupId, expiresAt: null, maxUses: 0 },
      orderBy: { createdAt: "asc" },
    });
    if (existing) {
      return NextResponse.json({
        ...existing,
        existing: true,
        group: { id: group.id, icon: group.icon },
      });
    }
  }

  // FIX-SEC: криптостойкий код приглашения (~72 бита, url-safe) вместо первых
  // 12 hex-символов UUID (48 бит) — не перечисляется.
  let code: string;
  let attempts = 0;
  do {
    code = randomBytes(9).toString("base64url");
    const existing = await prisma.invite.findUnique({ where: { code } });
    if (!existing) break;
    attempts++;
  } while (attempts < 5);

  if (attempts >= 5) {
    return NextResponse.json({ error: "Failed to generate unique code, try again" }, { status: 500 });
  }

  const expiresAt = inviteHours
    ? new Date(Date.now() + inviteHours * 3600000)
    : null;

  const invite = await prisma.invite.create({
    data: {
      code,
      groupId,
      createdBy: session.user.id,
      maxUses: inviteMaxUses,
      expiresAt,
    },
  });

  // Журнал аудита: кто и с какими параметрами создал приглашение.
  await logGroupAction({
    groupId,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "user",
    action: "invite.create",
    targetId: invite.code,
    details: `Срок: ${inviteHours ? inviteHours + " ч" : "бессрочно"}, лимит: ${inviteMaxUses > 0 ? inviteMaxUses : "∞"}`,
  });

  return NextResponse.json({
    ...invite,
    group: {
      id: group.id,
      icon: group.icon,
    },
  });
}
