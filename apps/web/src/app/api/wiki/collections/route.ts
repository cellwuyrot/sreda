import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { sanitizeText } from "@/lib/sanitize";
import prisma from "@/lib/prisma";

// FIX-WIKI: управление «полками» базы знаний — группами статей и словарями.
//
// POST   { channelId, name, kind: "GROUP" | "DICTIONARY", restricted? } — создать полку
// PATCH  { id, name?, restricted? }                                    — переименовать / скрыть
// DELETE ?id=...                                                       — удалить (статьи остаются без полки)
//
// Правила видимости: restricted-полку и её статьи видят только модератор и старше
// (роли группы OWNER/ADMIN/MODERATOR или администратор сайта). Обычные участники,
// даже с навешенными ролями-тегами, скрытое не видят.

const MANAGE_ROLES = ["OWNER", "ADMIN", "MODERATOR"];

function isModeratorPlus(membershipRole: string, userRole?: string | null): boolean {
  if ((userRole || "").toUpperCase() === "ADMIN") return true;
  return MANAGE_ROLES.includes((membershipRole || "").toUpperCase());
}

function canEditWiki(membershipRole: string, postAccess?: string | null, userRole?: string | null): boolean {
  const role = (membershipRole || "").toUpperCase();
  if ((userRole || "").toUpperCase() === "ADMIN") return true;
  if (role === "OWNER" || role === "ADMIN") return true;
  if (role === "MODERATOR") return postAccess !== "ADMIN";
  return postAccess === "ALL";
}

async function loadMember(channelId: string, userId: string, isSiteAdmin: boolean) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, groupId: true, postAccess: true },
  });
  if (!channel) return null;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: channel.groupId } },
  });
  const member = membership ?? (isSiteAdmin ? { id: "", role: "MODERATOR" } : null);
  if (!member) return null;
  return { channel, member };
}

// POST /api/wiki/collections
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const body = await req.json();
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const kind = body.kind === "DICTIONARY" ? "DICTIONARY" : "GROUP";
  if (!channelId || !name) return NextResponse.json({ error: "Укажите название полки" }, { status: 400 });

  const ctx = await loadMember(channelId, session.user.id, session.user.role === "ADMIN");
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!canEditWiki(ctx.member.role, ctx.channel.postAccess, session.user.role)) {
    return NextResponse.json({ error: "Нет прав на создание полок в этом разделе" }, { status: 403 });
  }

  // Ограничение видимости может ставить только модератор и старше
  const isMod = isModeratorPlus(ctx.member.role, session.user.role);
  const restricted = isMod && body.restricted === true;

  let collection;
  try {
    collection = await prisma.wikiCollection.create({
      data: { channelId, name: sanitizeText(name), kind, restricted },
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось создать полку: база данных не обновлена. Выполните `npx prisma db push` в apps/web." },
      { status: 500 },
    );
  }
  return NextResponse.json({ collection });
}

// PATCH /api/wiki/collections
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const body = await req.json();
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const col = await prisma.wikiCollection.findUnique({ where: { id } });
  if (!col) return NextResponse.json({ error: "Полка не найдена" }, { status: 404 });

  const ctx = await loadMember(col.channelId, session.user.id, session.user.role === "ADMIN");
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const isMod = isModeratorPlus(ctx.member.role, session.user.role);
  const data: { name?: string; restricted?: boolean } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    if (!canEditWiki(ctx.member.role, ctx.channel.postAccess, session.user.role)) {
      return NextResponse.json({ error: "Нет прав на изменение полки" }, { status: 403 });
    }
    data.name = sanitizeText(body.name.trim().slice(0, 80));
  }
  if (typeof body.restricted === "boolean") {
    if (!isMod) {
      return NextResponse.json({ error: "Ограничение видимости меняет только модератор и старше" }, { status: 403 });
    }
    data.restricted = body.restricted;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 });

  const collection = await prisma.wikiCollection.update({ where: { id }, data });
  return NextResponse.json({ collection });
}

// DELETE /api/wiki/collections?id=...
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const col = await prisma.wikiCollection.findUnique({ where: { id } });
  if (!col) return NextResponse.json({ error: "Полка не найдена" }, { status: 404 });

  const ctx = await loadMember(col.channelId, session.user.id, session.user.role === "ADMIN");
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isModeratorPlus(ctx.member.role, session.user.role)) {
    return NextResponse.json({ error: "Удалять полки может только модератор и старше" }, { status: 403 });
  }

  // Статьи не удаляются — связь сбрасывается (onDelete: SetNull в схеме)
  await prisma.wikiCollection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
