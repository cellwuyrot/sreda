import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { sanitizeText } from "@/lib/sanitize";
import { createNotificationsBulk } from "@/lib/createNotification";
import {
  MAX_WALL_ATTACHMENTS,
  MAX_WALL_CONTENT,
  MAX_WALL_PINNED,
  MAX_WALL_TITLE,
  WALL_AUTHOR_SELECT,
  WALL_PAGE_SIZE,
  parsePage,
  sanitizeWallAttachments,
  sanitizeWallMedia,
  serializeWallPost,
  wallHidden,
  type WallPostRow,
} from "@/lib/wallPost";

/**
 * PROFILE-WALL: стена конкретного человека.
 *
 *   GET  — страница записей (закреплённые сверху, дальше по убыванию даты)
 *   POST — опубликовать запись у СЕБЯ на стене
 *
 * Почему страницы, а не курсор, как в новостях: лента новостей — поток, по ней
 * движутся сверху вниз и обратно не возвращаются. Личную страницу читают иначе:
 * ищут запись месячной давности и хотят вернуться на ту же страницу завтра. Номер
 * страницы живёт в адресе, курсор — нет.
 */

const POST_INCLUDE = {
  author: { select: WALL_AUTHOR_SELECT },
  _count: { select: { comments: true } },
} as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!owner) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  if (await wallHidden(session.user.id, userId)) {
    return NextResponse.json({ error: "Страница недоступна" }, { status: 403 });
  }

  const page = parsePage(req.nextUrl.searchParams.get("page"));
  const where = { authorId: userId, deleted: false };

  const [total, rows] = await Promise.all([
    prisma.wallPost.count({ where }),
    prisma.wallPost.findMany({
      where,
      /* Закреплённое сверху на каждой странице выглядело бы как повтор,
         поэтому здесь общая сортировка, а не отдельная выборка: на стене
         закреплённых единицы и они целиком помещаются на первую страницу. */
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * WALL_PAGE_SIZE,
      take: WALL_PAGE_SIZE,
      include: POST_INCLUDE,
    }),
  ]);

  const isOwner = session.user.id === userId;
  const role = (session.user as { role?: string }).role;
  const viewer = {
    userId: session.user.id,
    isOwner,
    canModerate: role === "ADMIN" || role === "EDITOR",
  };

  return NextResponse.json({
    posts: (rows as unknown as WallPostRow[]).map((row) => serializeWallPost(row, viewer)),
    page,
    perPage: WALL_PAGE_SIZE,
    total,
    pages: Math.max(1, Math.ceil(total / WALL_PAGE_SIZE)),
    canPost: isOwner,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const limited = await rateLimit(req, "wall-post", { limit: 20, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const { userId } = await params;
  /* Писать на стене может только её владелец. Администратор тоже не может:
     запись от чужого имени — это не модерация, а подлог. */
  if (userId !== session.user.id) {
    return NextResponse.json({ error: "Можно публиковать только на своей странице" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const content = sanitizeText(typeof raw.content === "string" ? raw.content : "").slice(0, MAX_WALL_CONTENT);
  const title = sanitizeText(typeof raw.title === "string" ? raw.title : "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_WALL_TITLE);
  const cover = sanitizeWallMedia(raw.cover);
  const attachments = sanitizeWallAttachments(raw.attachments);

  /* Пустая запись без картинки и без файлов — это случайное нажатие кнопки. */
  if (!content.trim() && !cover && attachments.length === 0) {
    return NextResponse.json({ error: "Запись пустая" }, { status: 400 });
  }
  if (attachments.length > MAX_WALL_ATTACHMENTS) {
    return NextResponse.json({ error: `Вложений не больше ${MAX_WALL_ATTACHMENTS}` }, { status: 400 });
  }

  const post = await prisma.wallPost.create({
    data: {
      authorId: session.user.id,
      title: title || null,
      content,
      cover,
      attachments: attachments.length ? JSON.stringify(attachments) : null,
    },
    include: POST_INCLUDE,
  });

  /* Подписчики узнают о новой записи — иначе подписка ничего не даёт и стена
     остаётся местом, куда надо ходить самому. Рассылка пачкой: при тысяче
     подписчиков поодиночные записи в базу — тысяча запросов на одну кнопку. */
  const followers = await prisma.follow.findMany({
    where: { followingId: session.user.id },
    select: { followerId: true },
    take: 5000,
  });
  if (followers.length) {
    await createNotificationsBulk({
      userIds: followers.map((f) => f.followerId),
      type: "wall-post",
      title: `Новая запись: ${session.user.name || session.user.username}`,
      body: (title || content).slice(0, 140),
      link: `/profile/${session.user.username}?post=${post.id}`,
      actorId: session.user.id,
      entityType: "wall-post",
      entityId: post.id,
    });
  }

  return NextResponse.json(
    serializeWallPost(post as unknown as WallPostRow, {
      userId: session.user.id,
      isOwner: true,
      canModerate: false,
    }),
    { status: 201 },
  );
}

export { MAX_WALL_PINNED };
