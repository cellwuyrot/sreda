/**
 * NEWSPOST: модуль «Новости» как лента постов.
 *
 * ── Что здесь решается ──────────────────────────────────────────────────────
 *
 * Канал type=NEWS раньше был обычной перепиской, в которую разрешено писать
 * только модерации. Читалось это как чат, в котором все молчат: объявление
 * месячной давности уезжало вверх наравне с однострочной репликой, у него не
 * было ни заголовка, ни обложки, ни отдельного места для обсуждения.
 *
 * Пост — это то же сообщение (см. Message в schema.prisma), а лента — правила
 * поверх него: что показывать, в каком порядке, кому и когда. Правила и живут
 * здесь, отдельно от маршрутов, потому что ошибиться в них легко и незаметно:
 * лишний пост в чужой ленте — это утечка черновика, а неверный курсор — вечная
 * прокрутка по кругу.
 *
 * ── Чистая часть и часть с базой ────────────────────────────────────────────
 *
 * Ниже сначала идут функции без единого запроса — их и покрывают тесты. В
 * самом конце файла одна функция обращается к базе: рассылка уведомления о
 * публикации. Она здесь потому, что её зовут ДВОЕ — маршрут публикации и обход
 * отложенных постов в server.ts, — и разъехаться им нельзя: разойдись правила
 * «кому слать», и половина сообщества узнавала бы новость, а половина нет, в
 * зависимости от того, опубликовали пост сразу или по расписанию.
 */

import prisma from "@/lib/prisma";
import { createNotificationsBulk } from "@/lib/createNotification";
import { getChannelPermissions, type ChannelPermissions } from "@/lib/connectPermissions";

/** Длиннее заголовок не помещается ни в карточку ленты, ни в уведомление. */
export const MAX_POST_TITLE = 200;

/** Предел длины пути обложки — столько же, сколько в базе (VARCHAR(400)). */
export const MAX_POST_COVER = 400;

/**
 * Сколько знаков выжимки показывает карточка до «читать далее».
 *
 * Порог подобран так, чтобы в ленте помещалось несколько постов подряд: при
 * большем значении длинная новость занимает весь экран, и лента перестаёт быть
 * лентой.
 */
export const POST_EXCERPT_LIMIT = 400;

// ── Заголовок ────────────────────────────────────────────────────────────────

/**
 * Заголовок поста.
 *
 * Пустой заголовок и отсутствующий — одно и то же: карточка в обоих случаях
 * показывает только текст. Поэтому наружу всегда уходит строка, а не
 * `null | undefined | "   "`, — иначе клиенту пришлось бы проверять три вида
 * пустоты, и он бы проверил не все.
 */
export function normalizePostTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  /* Перевод строки в заголовке ломает вёрстку карточки, а взяться ему есть
     откуда: заголовок часто вставляют копированием. */
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_POST_TITLE);
}

// ── Обложка ──────────────────────────────────────────────────────────────────

/**
 * Обложка карточки.
 *
 * Принимается только путь в наше хранилище. Тот же класс дыры, что закрывает
 * sanitizeReminderLink у напоминаний: сохрани мы `https://evil.tld/pixel.png`,
 * и каждый, кто пролистал ленту, отдал бы чужому серверу свой адрес и заголовки
 * — при том что сам он открывал только наш сайт. `//evil.tld` браузер тоже
 * понимает как чужой сайт, а не как путь, поэтому двойная косая отбрасывается
 * отдельно.
 *
 * `..` в пути — попытка выбраться из каталога загрузок; обратная косая черта —
 * то же самое, но в записи, которую часть проверок пропускает.
 */
export function sanitizePostCover(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path) return null;
  if (!path.startsWith("/uploads/")) return null;
  if (path.startsWith("//")) return null;
  if (path.includes("..") || path.includes("\\")) return null;
  if (path.length > MAX_POST_COVER) return null;
  return path;
}

// ── Выжимка для карточки ─────────────────────────────────────────────────────

/**
 * Текст поста без разметки.
 *
 * В карточку идёт голый текст: разметка там не отрисовывается, и без этой
 * чистки в выжимке торчали бы решётки заголовков, звёздочки и целые адреса из
 * ссылок — то есть на месте первых строк новости человек видел бы
 * `## **Важно** [подробнее](https://…)`.
 */
export function stripPostMarkup(value: unknown): string {
  if (typeof value !== "string") return "";
  return (
    value
      // Блоки кода целиком: в выжимке от них нет пользы, только шум.
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      // Картинки — до ссылок: иначе от `![alt](src)` осталась бы «!».
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Заголовки, цитаты и маркеры списка — только в начале строки.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s{0,3}[-*+]\s+/gm, "")
      .replace(/^\s{0,3}\d+[.)]\s+/gm, "")
      // Горизонтальная черта превратилась бы в «---» посреди строки.
      .replace(/^\s{0,3}([-*_])\1{2,}\s*$/gm, " ")
      // Выделение. Символы убираются, слова остаются.
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      // Переносы строк в карточке всё равно схлопнутся — схлопываем сразу,
      // чтобы предел длины считался по видимым знакам, а не по пробелам.
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Выжимка для карточки ленты.
 *
 * Режется по границе слова: обрыв «сегодня в 15:00 начина…» читается как сбой,
 * а не как сокращение. Если в хвосте границы нет вовсе (одно длинное слово или
 * язык без пробелов), режем жёстко — иначе выжимка вернулась бы пустой.
 */
export function postExcerpt(value: unknown, limit: number = POST_EXCERPT_LIMIT): string {
  const text = stripPostMarkup(value);
  if (text.length <= limit) return text;

  const head = text.slice(0, limit);
  const lastSpace = head.lastIndexOf(" ");
  /* Граница ищется только в последней трети: пробел на десятом знаке из
     четырёхсот обрезал бы новость до одного слова. */
  const cut = lastSpace > limit * 0.6 ? head.slice(0, lastSpace) : head;
  return `${cut.replace(/[\s.,;:!?—–-]+$/, "")}…`;
}

/**
 * Нужна ли карточке кнопка «читать далее».
 *
 * Считается по тому же очищенному тексту, что и выжимка. Считай мы по сырому,
 * пост из четырёх строк ссылок получал бы кнопку, за которой ничего нет.
 */
export function needsPostExpand(value: unknown, limit: number = POST_EXCERPT_LIMIT): boolean {
  return stripPostMarkup(value).length > limit;
}

// ── Видимость ────────────────────────────────────────────────────────────────

export interface PostVisibility {
  /** Автор поста. */
  userId: string;
  draft: boolean;
  publishAt: Date | string | null;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Виден ли пост этому человеку.
 *
 * Два состояния прячут пост от всех, кроме автора: черновик и назначенное на
 * будущее время. Модерация тоже не видит — черновик пишется «для себя», и
 * увидеть его до публикации не должен никто, иначе черновиком просто перестают
 * пользоваться.
 *
 * Право читать канал проверяется отдельно и раньше: сюда пост доходит уже из
 * канала, который человеку доступен.
 */
export function isPostVisible(post: PostVisibility, viewerId: string, now: number = Date.now()): boolean {
  const isAuthor = !!viewerId && post.userId === viewerId;
  if (isAuthor) return true;
  if (post.draft) return false;
  const publishAt = toTime(post.publishAt);
  return publishAt === null || publishAt <= now;
}

/**
 * Опубликован ли пост «по-настоящему» — то есть виден не только автору.
 *
 * Отличается от isPostVisible тем, что не спрашивает, кто смотрит: на этом
 * держатся уведомления и счётчик просмотров, которым авторство безразлично.
 */
export function isPostPublished(post: PostVisibility, now: number = Date.now()): boolean {
  if (post.draft) return false;
  const publishAt = toTime(post.publishAt);
  return publishAt === null || publishAt <= now;
}

// ── Порядок в ленте и постраничная выдача ────────────────────────────────────

export interface FeedOrderable {
  pinned: boolean;
  createdAt: Date | string;
}

/**
 * Порядок ленты: закреплённое первым, дальше — от свежего к старому.
 *
 * Закреплённые посты выбираются отдельным запросом (иначе курсор по дате
 * выбрасывал бы старое закрепление со второй страницы или, наоборот, повторял
 * его на каждой), поэтому склеенный список нужно упорядочить здесь.
 */
export function comparePostsForFeed(a: FeedOrderable, b: FeedOrderable): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return (toTime(b.createdAt) ?? 0) - (toTime(a.createdAt) ?? 0);
}

/**
 * Курсор постраничной выдачи — момент времени последнего показанного поста.
 *
 * Строгая проверка формата нужна не из аккуратности: `new Date("20")` в
 * браузерном движке даёт вполне валидную дату где-то в 2001 году, и мусорный
 * курсор молча отдал бы совсем другую страницу вместо ошибки. Непонятный
 * курсор здесь превращается в null, и лента начинается сначала — это заметно
 * и безопасно.
 */
export function parseFeedCursor(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Сколько постов отдавать за раз. Больше сотни — почти наверняка выкачивание. */
export function parseFeedLimit(value: unknown, fallback = 20): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), 50);
}

// ── Уведомление о публикации ─────────────────────────────────────────────────

export interface PostAnnounceState {
  draft: boolean;
  publishAt: Date | string | null;
  announcedAt: Date | string | null;
}

/**
 * Пора ли рассылать уведомление о посте.
 *
 * Три причины промолчать, и каждая когда-то была бы багом:
 *   • черновик — уведомление о том, чего ещё нет;
 *   • уже уведомляли — вторая волна о той же новости;
 *   • время публикации не наступило — новость придёт раньше, чем появится.
 */
export function shouldAnnouncePost(post: PostAnnounceState, now: number = Date.now()): boolean {
  if (post.draft) return false;
  if (toTime(post.announcedAt) !== null) return false;
  const publishAt = toTime(post.publishAt);
  return publishAt === null || publishAt <= now;
}

/** Дальше года вперёд откладывать публикацию бессмысленно (как у напоминаний). */
export const MAX_PUBLISH_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Время отложенной публикации из тела запроса.
 *
 * Возвращает `{ ok: false }` только на том, что похоже на ошибку клиента:
 * нечитаемую дату и дату дальше года вперёд (почти всегда это промах в поле
 * ввода года). Время в прошлом ошибкой не считается и превращается в null —
 * «опубликовать сейчас»: между нажатием «запланировать на 12:00» и приходом
 * запроса могло пройти время, и отказывать за это было бы издевательством.
 */
export function parsePublishAt(value: unknown, now: number = Date.now()): { ok: boolean; value: Date | null } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const time = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return { ok: false, value: null };
  if (time > now + MAX_PUBLISH_AHEAD_MS) return { ok: false, value: null };
  if (time <= now) return { ok: true, value: null };
  return { ok: true, value: new Date(time) };
}

// ── Кому виден канал (для рассылки) ──────────────────────────────────────────

export interface ReadableChannel {
  hidden: boolean;
  isRestricted: boolean;
  /** ALL | MOD | ADMIN — см. Channel.readAccess. */
  readAccess: string;
  /** Теги, допущенные к просмотру (scope VIEW). Пусто — ограничения нет. */
  allowedRoleIds: string[];
  paused: boolean;
}

export interface ChannelMemberView {
  userId: string;
  /** Встроенная роль в сообществе: OWNER | ADMIN | MODERATOR | MEMBER. */
  role: string;
  /** Заглушено ли сообщество целиком. */
  muted: boolean;
  /** Теги участника. */
  roleIds: string[];
}

/**
 * Может ли участник читать канал.
 *
 * ВАЖНО: это повторение правил из connectPermissions (там их считает evaluate,
 * поле canView). Повторять пришлось потому, что рассылка идёт сразу по всем
 * участникам сообщества, а getChannelPermissions делает два запроса на
 * человека: на сообществе в тысячу человек это две тысячи запросов ради одного
 * уведомления.
 *
 * Правила здесь намеренно НЕ мягче исходных: ошибка в сторону строгости — это
 * непришедшее уведомление, ошибка в сторону мягкости — заголовок закрытой
 * новости в шторке телефона у того, кому канал недоступен. Меняются правила
 * чтения — правятся оба места.
 */
export function canReadChannelAsMember(channel: ReadableChannel, member: ChannelMemberView): boolean {
  const role = member.role;
  const canManage = role === "OWNER" || role === "ADMIN";
  const canModerate = canManage || role === "MODERATOR";

  const hasAllowedRole = channel.allowedRoleIds.length === 0 || channel.allowedRoleIds.some((id) => member.roleIds.includes(id));
  if (channel.isRestricted && !canModerate && !hasAllowedRole) return false;
  if (channel.hidden && !canModerate) return false;
  if (channel.readAccess === "ADMIN" && !canManage) return false;
  if (channel.readAccess === "MOD" && !canModerate) return false;
  /* Приостановленное сообщество продолжает жить только для владельца и
     администраторов — как и в connectPermissions. */
  if (channel.paused && !canManage) return false;
  return true;
}

/**
 * Кому уйдёт уведомление о новом посте.
 *
 * Автору — нет: он и так знает. Заглушившим канал или сообщество — нет, ради
 * этого заглушку и включают. Явное «снять заглушку» на канале сильнее заглушки
 * сообщества: человек выключил всё, кроме новостей, и должен получать именно
 * новости (та же логика, что у @everyone в /api/messages).
 */
export function selectAnnounceRecipients(params: {
  authorId: string;
  channel: ReadableChannel;
  members: ChannelMemberView[];
  /** Строки ChannelMute по этому каналу: muted=true — заглушен, false — явно включён. */
  channelMutes: { userId: string; muted: boolean }[];
}): string[] {
  const mutedChannel = new Set(params.channelMutes.filter((entry) => entry.muted === true).map((entry) => entry.userId));
  const unmutedChannel = new Set(params.channelMutes.filter((entry) => entry.muted === false).map((entry) => entry.userId));

  const recipients: string[] = [];
  for (const member of params.members) {
    if (member.userId === params.authorId) continue;
    if (!canReadChannelAsMember(params.channel, member)) continue;
    if (mutedChannel.has(member.userId)) continue;
    if (member.muted && !unmutedChannel.has(member.userId)) continue;
    recipients.push(member.userId);
  }
  return recipients;
}

// ── Как пост выглядит снаружи ────────────────────────────────────────────────

export interface NewsPostAuthor {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
}

export interface NewsPostReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface NewsPost {
  id: string;
  title: string;
  content: string;
  cover: string | null;
  attachments: unknown[];
  author: NewsPostAuthor;
  createdAt: string;
  editedAt: string | null;
  pinned: boolean;
  views: number;
  commentsClosed: boolean;
  commentCount: number;
  reactions: NewsPostReaction[];
  draft: boolean;
  publishAt: string | null;
  canEdit: boolean;
}

export interface NewsPostRow {
  id: string;
  title: string | null;
  content: string;
  cover: string | null;
  attachments: string | null;
  pinned: boolean;
  views: number;
  commentsClosed: boolean;
  draft: boolean;
  publishAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  userId: string;
  user: { id: string; name: string; username: string; avatar: string | null };
  reactions: { emoji: string; userId: string }[];
  _count?: { threadReplies: number } | null;
  threadCount?: number;
}

/**
 * Вложения хранятся строкой JSON (так же, как у сообщений).
 *
 * Разбор обёрнут потому, что строка в базе могла быть записана чем угодно и
 * когда угодно: одна битая строка не должна ронять всю ленту — пост просто
 * покажется без вложений.
 */
export function parsePostAttachments(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Реакции для карточки: по одной строке на смайл.
 *
 * Клиенту нужен счётчик и признак «моя», а не список из трёхсот
 * идентификаторов: без свёртки популярный пост тащил бы в ленту по килобайту
 * идентификаторов на каждый смайл. Порядок — по первому появлению, чтобы
 * реакции не прыгали местами при каждом обновлении.
 */
export function foldPostReactions(reactions: { emoji: string; userId: string }[], viewerId: string): NewsPostReaction[] {
  const byEmoji = new Map<string, NewsPostReaction>();
  for (const reaction of reactions) {
    const entry = byEmoji.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false };
    entry.count += 1;
    if (reaction.userId === viewerId) entry.mine = true;
    byEmoji.set(reaction.emoji, entry);
  }
  return Array.from(byEmoji.values());
}

/**
 * Пост в том виде, в каком его ждёт лента.
 *
 * Собран в одном месте намеренно: четыре маршрута отдают пост, и стоит одному
 * из них забыть поле — интерфейс на этом посте ломается ровно после того
 * действия, которое его вернуло (например, после правки пропадают реакции).
 */
export function serializeNewsPost(row: NewsPostRow, viewer: { userId: string; canModerate: boolean }): NewsPost {
  return {
    id: row.id,
    title: row.title ?? "",
    content: row.content,
    cover: row.cover,
    attachments: parsePostAttachments(row.attachments),
    author: {
      id: row.user.id,
      name: row.user.name,
      username: row.user.username,
      avatar: row.user.avatar ?? null,
    },
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    pinned: row.pinned,
    views: row.views,
    commentsClosed: row.commentsClosed,
    /* Счётчик берётся из _count, а не из threadCount: threadCount — это
       денормализация, которая переживает удаление комментариев и начинает
       врать. Если _count не запрашивали, падаем обратно на него. */
    commentCount: row._count?.threadReplies ?? row.threadCount ?? 0,
    reactions: foldPostReactions(row.reactions, viewer.userId),
    draft: row.draft,
    publishAt: row.publishAt ? row.publishAt.toISOString() : null,
    canEdit: row.userId === viewer.userId || viewer.canModerate,
  };
}

/** Поля поста, нужные ленте. Один набор на все маршруты — см. serializeNewsPost. */
export const NEWS_POST_INCLUDE = {
  user: { select: { id: true, name: true, username: true, avatar: true } },
  reactions: { select: { emoji: true, userId: true } },
  _count: { select: { threadReplies: true } },
} as const;

// ── Единственная часть с обращением к базе ───────────────────────────────────

export type PostAccess =
  | { ok: true; post: NewsPostRow & { channelId: string; commentsClosed: boolean; announcedAt: Date | null }; permission: ChannelPermissions }
  | { ok: false; status: number; error: string };

/**
 * Найти пост и решить, что этому человеку с ним можно.
 *
 * Один вызов на три маршрута (правка/удаление, просмотр, комментарии) — потому
 * что проверок здесь пять и порядок у них не случайный: сначала «пост вообще
 * существует», потом «это пост, а не комментарий», потом права на канал и лишь
 * затем видимость. Разложи это по трём файлам — и один из них рано или поздно
 * забудет про черновик, отдав его по прямой ссылке.
 *
 * Отдельно про 404 вместо 403 на невидимом посте: разница между «поста нет» и
 * «пост есть, но он чужой черновик» — это и есть утечка. По ответу не должно
 * быть понятно, что автор что-то пишет.
 */
export async function loadPostForViewer(postId: string, viewerId: string): Promise<PostAccess> {
  if (!postId) return { ok: false, status: 404, error: "Пост не найден" };

  const post = await prisma.message.findUnique({
    where: { id: postId },
    select: {
      id: true,
      title: true,
      content: true,
      cover: true,
      attachments: true,
      pinned: true,
      views: true,
      commentsClosed: true,
      draft: true,
      publishAt: true,
      announcedAt: true,
      editedAt: true,
      createdAt: true,
      userId: true,
      channelId: true,
      threadId: true,
      threadCount: true,
      ...NEWS_POST_INCLUDE,
    },
  });
  /* Комментарий постом не является: иначе PATCH /api/posts/<id комментария>
     позволял бы приделать к реплике обложку и заголовок и вытолкнуть её в
     ленту. */
  if (!post || post.threadId) return { ok: false, status: 404, error: "Пост не найден" };

  const permission = await getChannelPermissions(viewerId, post.channelId);
  if (!permission || !permission.canView) {
    return { ok: false, status: permission ? 403 : 404, error: permission?.denialReason ?? "Пост не найден" };
  }
  if (!isPostVisible(post, viewerId)) return { ok: false, status: 404, error: "Пост не найден" };

  return { ok: true, post, permission };
}

/**
 * Разослать уведомление о публикации поста.
 *
 * Живёт здесь, а не в маршруте, потому что вызывающих двое: публикация «прямо
 * сейчас» (POST /api/channels/[id]/posts, PATCH при снятии черновика) и обход
 * отложенных постов в server.ts. Две копии этой функции неизбежно разошлись бы
 * в списке получателей, и половина сообщества узнавала бы новость, а половина
 * нет — в зависимости от того, опубликовали пост сразу или по расписанию.
 *
 * ПОРЯДОК ВАЖЕН: отметка announcedAt ставится ДО рассылки и только если её ещё
 * никто не поставил (updateMany с условием announcedAt: null — заявка, которую
 * выигрывает один процесс). Упади рассылка после отметки — люди не получат
 * одно уведомление. При обратном порядке они получали бы его каждые полминуты,
 * пока сбой не починят.
 *
 * Возвращает число созданных уведомлений; -1 означает «отметку забрал кто-то
 * другой, рассылать не наше дело».
 */
export async function announceNewsPost(postId: string): Promise<number> {
  const post = await prisma.message.findUnique({
    where: { id: postId },
    select: {
      id: true,
      userId: true,
      channelId: true,
      title: true,
      content: true,
      draft: true,
      publishAt: true,
      announcedAt: true,
      threadId: true,
      user: { select: { name: true } },
      channel: {
        select: {
          id: true,
          groupId: true,
          name: true,
          hidden: true,
          isRestricted: true,
          readAccess: true,
          group: { select: { paused: true } },
          allowedRoles: { where: { scope: "VIEW" }, select: { roleId: true } },
        },
      },
    },
  });
  /* Комментарий (threadId заполнен) постом не является и уведомлять о себе
     ленту не должен — на случай, если сюда придёт чужой идентификатор. */
  if (!post || post.threadId) return 0;
  if (!shouldAnnouncePost(post)) return 0;

  const claimed = await prisma.message.updateMany({
    where: { id: post.id, announcedAt: null },
    data: { announcedAt: new Date() },
  });
  if (claimed.count !== 1) return -1;

  const members = await prisma.groupMember.findMany({
    where: { groupId: post.channel.groupId },
    select: { userId: true, role: true, muted: true, tags: { select: { roleId: true } } },
  });
  /* Заглушки канала — одним запросом на всех, а не findUnique на каждого:
     иначе рассылка по сообществу в тысячу человек стоила бы тысячу запросов. */
  const channelMutes = await prisma.channelMute.findMany({
    where: { channelId: post.channelId, userId: { in: members.map((member) => member.userId) } },
    select: { userId: true, muted: true },
  });

  const recipients = selectAnnounceRecipients({
    authorId: post.userId,
    channel: {
      hidden: post.channel.hidden,
      isRestricted: post.channel.isRestricted,
      readAccess: post.channel.readAccess,
      allowedRoleIds: post.channel.allowedRoles.map((entry) => entry.roleId),
      paused: post.channel.group.paused,
    },
    members: members.map((member) => ({
      userId: member.userId,
      role: member.role,
      muted: member.muted,
      roleIds: member.tags.map((tag) => tag.roleId),
    })),
    channelMutes,
  });
  if (recipients.length === 0) return 0;

  return createNotificationsBulk({
    userIds: recipients,
    type: "news",
    title: `Новость в #${post.channel.name}`,
    /* В шторку телефона уходит заголовок поста, а если его нет — начало
       текста: «Новость» без единого слова о содержании не даёт решить,
       открывать её сейчас или потом. */
    body: (normalizePostTitle(post.title) || postExcerpt(post.content, 120)).slice(0, 160),
    link: `/connect?group=${post.channel.groupId}&channel=${post.channelId}&post=${post.id}`,
    actorId: post.userId,
    entityType: "news_post",
    entityId: post.id,
  });
}
