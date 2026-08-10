import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { sanitizeText } from "@/lib/sanitize";
import prisma from "@/lib/prisma";
import { getChannelPermissions } from "@/lib/connectPermissions";

// Роли группы, у которых всегда есть права модерации раздела
const MANAGE_ROLES = ["OWNER", "ADMIN", "MODERATOR"];

// FIX-WIKI: модератор и старше (или администратор сайта) — видит скрытые статьи и полки
function isModeratorPlus(membershipRole: string, userRole?: string | null): boolean {
  if ((userRole || "").toUpperCase() === "ADMIN") return true;
  return MANAGE_ROLES.includes((membershipRole || "").toUpperCase());
}

// Кто может редактировать базу знаний (см. комментарий в /api/wiki/route.ts):
//  - postAccess "ADMIN" -> только владелец/админ группы;
//  - postAccess "MOD"   -> владелец/админ + модераторы;
//  - postAccess "ALL"   -> все участники группы;
//  - администратор сайта — всегда.
function canEditWiki(membershipRole: string, postAccess?: string | null, userRole?: string | null): boolean {
  // ФИКС: роли сравниваем без учёта регистра — записи, изменённые вручную в БД
  // (например "admin" вместо "ADMIN") больше не приводят к потере прав.
  const role = (membershipRole || "").toUpperCase();
  if ((userRole || "").toUpperCase() === "ADMIN") return true;
  if (role === "OWNER" || role === "ADMIN") return true;
  if (role === "MODERATOR") return postAccess !== "ADMIN";
  return postAccess === "ALL";
}

/**
 * FIX-SEC-ACL: кто может читать раздел базы знаний.
 *
 * Прежняя местная проверка знала только про «Только выбранные роли», но не про
 * скрытые каналы и не про закрытое чтение — обе настройки появились позже и
 * прошли мимо этого файла. Права считает общая функция, та же, что при чтении
 * канала. Исключение прежнее: администратор сайта заходит без членства.
 */
async function canReadWikiChannel(userId: string, channelId: string, siteRole?: string | null): Promise<boolean> {
  if ((siteRole || "").toUpperCase() === "ADMIN") return true;
  const permissions = await getChannelPermissions(userId, channelId);
  return !!permissions?.canView;
}

async function loadCtx(articleId: string, userId: string, userRole?: string | null) {
  const article = await prisma.wikiArticle.findUnique({
    where: { id: articleId },
    include: {
      channel: { select: { groupId: true, postAccess: true, isRestricted: true, allowedRoles: { where: { scope: "VIEW" }, select: { roleId: true } } } },
      collection: { select: { id: true, name: true, restricted: true } }, // FIX-WIKI
      updatedBy: { select: { id: true, name: true, username: true } },
    },
  });
  if (!article) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const isSiteAdmin = (userRole || "").toUpperCase() === "ADMIN";
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: article.channel.groupId } },
  });
  // ФИКС: администратор сайта имеет доступ к базе знаний даже без членства в группе
  const member = membership ?? (isSiteAdmin ? { id: "", role: "MODERATOR" } : null);
  if (!member) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  if (!(await canReadWikiChannel(userId, article.channelId, userRole))) {
    return { error: NextResponse.json({ error: "Нет доступа к этому разделу" }, { status: 403 }) };
  }
  const isMod = isModeratorPlus(member.role, userRole);
  // FIX-WIKI: скрытая статья (или статья в скрытой полке) недоступна обычному участнику
  // даже по прямой ссылке — отвечаем 404, не раскрывая её существование.
  if (!isMod && (article.restricted || article.collection?.restricted)) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { article, membership: member, isMod };
}

// GET /api/wiki/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ctx = await loadCtx(id, session.user.id, session.user.role);
  if (ctx.error) return ctx.error;
  const canEdit = canEditWiki(ctx.membership!.role, ctx.article!.channel.postAccess, session.user.role);
  return NextResponse.json({ article: ctx.article, canEdit, canModerate: ctx.isMod });
}

// PATCH /api/wiki/[id]  { title?, content?, category?, term?, collectionId?, restricted? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const ctx = await loadCtx(id, session.user.id, session.user.role);
  if (ctx.error) return ctx.error;
  if (!canEditWiki(ctx.membership!.role, ctx.article!.channel.postAccess, session.user.role)) {
    return NextResponse.json({ error: "Нет прав на редактирование статей в этом разделе" }, { status: 403 });
  }

  const { title, content, category, term, collectionId, restricted } = await req.json();
  const data: { title?: string; content?: string; category?: string; term?: string | null; collectionId?: string | null; restricted?: boolean; updatedById: string } = { updatedById: session.user.id };
  if (typeof title === "string" && title.trim()) data.title = sanitizeText(title).slice(0, 200);
  if (typeof category === "string") data.category = category.slice(0, 80);
  if (typeof term === "string") data.term = term.trim() ? term.slice(0, 120) : null;

  // FIX-WIKI: перенос статьи между полками (только в пределах своего раздела)
  if (collectionId !== undefined) {
    if (!collectionId) {
      data.collectionId = null;
    } else if (typeof collectionId === "string") {
      const col = await prisma.wikiCollection.findUnique({ where: { id: collectionId } });
      if (!col || col.channelId !== ctx.article!.channelId) {
        return NextResponse.json({ error: "Полка не найдена" }, { status: 400 });
      }
      if (col.restricted && !ctx.isMod) {
        return NextResponse.json({ error: "Нет доступа к этой полке" }, { status: 403 });
      }
      data.collectionId = col.id;
    }
  }

  // FIX-WIKI: ограничение видимости меняет только модератор и старше
  if (typeof restricted === "boolean") {
    if (restricted !== ctx.article!.restricted && !ctx.isMod) {
      return NextResponse.json({ error: "Ограничение видимости меняет только модератор и старше" }, { status: 403 });
    }
    if (ctx.isMod) data.restricted = restricted;
  }

  // При изменении текста сохраняем предыдущую версию в историю правок
  if (typeof content === "string" && content !== ctx.article!.content) {
    if (content.length > 50000) return NextResponse.json({ error: "Слишком длинный текст статьи (макс. 50 000 символов)" }, { status: 400 });
    await prisma.wikiRevision.create({
      data: { articleId: id, content: ctx.article!.content, editorId: ctx.article!.updatedById },
    });
    data.content = content;
  }

  const updated = await prisma.wikiArticle.update({ where: { id }, data });
  return NextResponse.json({ article: updated });
}

// DELETE /api/wiki/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ctx = await loadCtx(id, session.user.id, session.user.role);
  if (ctx.error) return ctx.error;
  if (!canEditWiki(ctx.membership!.role, ctx.article!.channel.postAccess, session.user.role)) {
    return NextResponse.json({ error: "Нет прав на удаление статей в этом разделе" }, { status: 403 });
  }
  await prisma.wikiArticle.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
