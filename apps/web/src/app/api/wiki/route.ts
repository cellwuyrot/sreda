import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { checkBan } from "@/lib/banCheck";
import { sanitizeText } from "@/lib/sanitize";
import prisma from "@/lib/prisma";
import { getChannelPermissions } from "@/lib/connectPermissions";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "article";
}

// Роли группы, у которых всегда есть права модерации раздела
const MANAGE_ROLES = ["OWNER", "ADMIN", "MODERATOR"];

// FIX-WIKI: модератор и старше (или администратор сайта) — видит скрытые статьи и полки.
// Обычный участник (даже с навешенными ролями-тегами) — не видит.
function isModeratorPlus(membershipRole: string, userRole?: string | null): boolean {
  if ((userRole || "").toUpperCase() === "ADMIN") return true;
  return MANAGE_ROLES.includes((membershipRole || "").toUpperCase());
}

// Кто может редактировать базу знаний (создавать/править/удалять статьи):
//  - postAccess "ADMIN" -> только владелец/админ группы;
//  - postAccess "MOD"   -> владелец/админ + модераторы (режим «создатель + модератор»);
//  - postAccess "ALL"   -> все участники группы;
//  - администратор сайта — всегда.
// Настраивается через шестерёнку в шапке модуля (ModuleSettingsModal).
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
 * Здесь была своя проверка на полтора десятка строк, и знала она только про
 * «Только выбранные роли» (isRestricted + allowedRoles). Про скрытые каналы
 * (hidden) и про закрытое чтение (readAccess) она не знала — обе настройки
 * появились позже и прошли мимо этого файла. В итоге вики скрытого канала
 * читал любой участник сообщества, хотя самого канала в списке у него нет.
 *
 * Теперь права считает общая функция — та же, что в чтении канала. Исключение
 * одно и прежнее: администратор сайта заходит в базу знаний без членства в
 * сообществе (иначе он не сможет разбирать жалобы на её содержимое).
 */
async function canReadWikiChannel(userId: string, channelId: string, siteRole?: string | null): Promise<boolean> {
  if ((siteRole || "").toUpperCase() === "ADMIN") return true;
  const permissions = await getChannelPermissions(userId, channelId);
  return !!permissions?.canView;
}

// GET /api/wiki?channelId=...&q=...&category=...
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channelId");
  const q = searchParams.get("q")?.trim();
  const category = searchParams.get("category")?.trim();
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { groupId: true, postAccess: true, isRestricted: true, allowedRoles: { where: { scope: "VIEW" }, select: { roleId: true } } },
  });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: channel.groupId } },
  });
  // ФИКС: администратор сайта имеет доступ к базе знаний даже без членства в группе
  const member = membership ?? (session.user.role === "ADMIN" ? { id: "", role: "MODERATOR" } : null);
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!(await canReadWikiChannel(session.user.id, channelId, session.user.role))) {
    return NextResponse.json({ error: "Нет доступа к этому разделу" }, { status: 403 });
  }

  const isMod = isModeratorPlus(member.role, session.user.role);

  const where: { channelId: string; category?: string; OR?: unknown[]; AND?: unknown[] } = { channelId };
  if (category) where.category = category;
  if (q) where.OR = [
    { title: { contains: q, mode: "insensitive" } },
    { content: { contains: q, mode: "insensitive" } },
  ];
  // FIX-WIKI: обычные участники не видят скрытые статьи и статьи в скрытых полках.
  // Модератор и старше видит всё.
  if (!isMod) {
    where.AND = [
      { restricted: false },
      { OR: [{ collectionId: null }, { collection: { restricted: false } }] },
    ];
  }

  const [articles, collections] = await Promise.all([
    prisma.wikiArticle.findMany({
      where: where as never,
      select: {
        id: true, title: true, term: true, slug: true, category: true, updatedAt: true,
        restricted: true, collectionId: true, // FIX-WIKI
        updatedBy: { select: { id: true, name: true, username: true } },
      },
      orderBy: [{ category: "asc" }, { title: "asc" }],
      take: 500,
    }),
    // FIX-WIKI: полки раздела (группы статей и словари); скрытые — только модераторам и старше
    prisma.wikiCollection.findMany({
      where: { channelId, ...(isMod ? {} : { restricted: false }) },
      select: { id: true, name: true, kind: true, restricted: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const canEdit = canEditWiki(member.role, channel.postAccess, session.user.role);
  return NextResponse.json({ articles, collections, canEdit, canModerate: isMod });
}

// POST /api/wiki  { channelId, title, content, category, term, collectionId?, restricted? }
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "wiki", { limit: 30, windowMs: 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const body = await req.json();
  const { channelId, content, category, term } = body;
  // ФИКС: для записи словаря достаточно поля «Термин» — заголовок берём из него
  const title: string = typeof body.title === "string" && body.title.trim()
    ? body.title
    : (typeof term === "string" ? term : "");
  if (!channelId || !title.trim()) return NextResponse.json({ error: "Заполните заголовок статьи или термин" }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: "Слишком длинный заголовок (макс. 200 символов)" }, { status: 400 });
  if (typeof content === "string" && content.length > 50000) return NextResponse.json({ error: "Слишком длинный текст статьи (макс. 50 000 символов)" }, { status: 400 });

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { groupId: true, type: true, postAccess: true, isRestricted: true, allowedRoles: { where: { scope: "VIEW" }, select: { roleId: true } } },
  });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  // ФИКС БАГА: раньше здесь была жёсткая проверка channel.type !== "WIKI" -> 400 "Not a Wiki channel".
  // Разделы-блоки создаются с типом "NEWS"/"TEXT", поэтому создание статей и терминов
  // словаря в них падало, а интерфейс не показывал ошибку. Теперь запрещены только
  // заведомо неподходящие типы каналов.
  if (channel.type === "VOICE" || channel.type === "CATEGORY") {
    return NextResponse.json({ error: "Этот канал не поддерживает базу знаний" }, { status: 400 });
  }

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: channel.groupId } },
  });
  // ФИКС: администратор сайта имеет доступ к базе знаний даже без членства в группе
  const member = membership ?? (session.user.role === "ADMIN" ? { id: "", role: "MODERATOR" } : null);
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await canReadWikiChannel(session.user.id, channelId, session.user.role))) {
    return NextResponse.json({ error: "Нет доступа к этому разделу" }, { status: 403 });
  }
  if (!canEditWiki(member.role, channel.postAccess, session.user.role)) {
    return NextResponse.json({ error: "Нет прав на создание статей в этом разделе" }, { status: 403 });
  }

  const isMod = isModeratorPlus(member.role, session.user.role);

  // FIX-WIKI: привязка к полке — только полка этого же раздела
  let collectionId: string | null = null;
  if (typeof body.collectionId === "string" && body.collectionId) {
    const col = await prisma.wikiCollection.findUnique({ where: { id: body.collectionId } });
    if (!col || col.channelId !== channelId) {
      return NextResponse.json({ error: "Полка не найдена" }, { status: 400 });
    }
    if (col.restricted && !isMod) {
      return NextResponse.json({ error: "Нет доступа к этой полке" }, { status: 403 });
    }
    collectionId = col.id;
  }

  // FIX-WIKI: пометку «только для модераторов и старше» ставит только модератор+
  const restricted = isMod && body.restricted === true;

  let slug = slugify(title);
  const existing = await prisma.wikiArticle.findUnique({ where: { channelId_slug: { channelId, slug } } });
  if (existing) slug = slug + "-" + Date.now().toString(36);

  const article = await prisma.wikiArticle.create({
    data: {
      channelId,
      title: sanitizeText(title),
      slug,
      content: typeof content === "string" ? content : "",
      category: typeof category === "string" ? category.slice(0, 80) : "",
      term: typeof term === "string" && term.trim() ? term.slice(0, 120) : null,
      collectionId, // FIX-WIKI
      restricted, // FIX-WIKI
      updatedById: session.user.id,
    },
  });

  return NextResponse.json({ article });
}
