/**
 * NEWS: словарь ленты новостей и вся её часть, которой не нужен React.
 *
 * ── Зачем отдельный файл ────────────────────────────────────────────────────
 *
 * Лента, карточка и экран поста читают один и тот же ответ сервера. Держи типы
 * в компонентах — и расхождение с сервером пришлось бы ловить в трёх местах по
 * отдельности; тут же оно ловится один раз, при сборке.
 *
 * Сюда вынесено и всё, что считается без разметки: обложка, выжимка, подписи к
 * числам и датам. Такие вещи ломаются молча — «1,2 тыс.» вместо «1234» никто не
 * заметит на глаз, а «1 комментариев» заметят все. Чистые функции проверяет
 * types.test.ts, компонентам остаётся вёрстка.
 */

export interface NewsAuthor {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
}

export interface NewsReaction {
  emoji: string;
  count: number;
  /** Ставил ли реакцию тот, кто смотрит. */
  mine: boolean;
}

export interface NewsPost {
  id: string;
  title: string;
  content: string;
  cover: string | null;
  /**
   * Сервер отдаёт вложения как есть, разбором занимается клиент — см.
   * parseNewsAttachments. Тип нарочно `unknown[]`: в базе лежит JSON, который
   * когда-то записал другой клиент, и полей в нём может не быть вовсе.
   */
  attachments: unknown[];
  author: NewsAuthor;
  createdAt: string;
  editedAt: string | null;
  pinned: boolean;
  views: number;
  commentsClosed: boolean;
  commentCount: number;
  reactions: NewsReaction[];
  draft: boolean;
  publishAt: string | null;
  canEdit: boolean;
}

export interface NewsComment {
  id: string;
  content: string;
  author: NewsAuthor;
  createdAt: string;
}

/** Ответ GET /api/channels/:id/posts. */
export interface NewsPage {
  posts: NewsPost[];
  nextCursor: string | null;
  canPost: boolean;
}

/** Ответ GET /api/posts/:id/comments. */
export interface NewsCommentPage {
  comments: NewsComment[];
  canComment: boolean;
  /** Курсор следующей страницы, если сервер её отдаёт. */
  nextCursor?: string | null;
}

/** Разобранное вложение поста — то, что вёрстка умеет показать. */
export interface NewsAttachment {
  url: string;
  name: string;
  size: number;
  type: string;
  isImage: boolean;
  isVideo: boolean;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i;

/**
 * Разрешаем в src/href только безопасные схемы.
 *
 * Адрес вложения приходит внутри JSON поста, а JSON когда-то сформировал
 * клиент — значит, доверять ему вслепую нельзя: `javascript:` исполнится по
 * нажатию на ссылку, а `data:` в части браузеров — прямо при загрузке картинки.
 *
 * Точно такая же проверка живёт внутри MessageArea.tsx и DMMessageList.tsx, но
 * там она модульная и наружу не выведена. Своя копия здесь лучше, чем импорт
 * из компонента чата на две тысячи строк ради одной функции.
 */
export function safeMediaUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  if (url.startsWith("/uploads/")) return url;
  try {
    const parsed = new URL(url, "https://x.invalid");
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {
    /* адрес не разбирается — показывать его нечем */
  }
  return null;
}

/**
 * Вложения поста в пригодном для вывода виде.
 *
 * Всё, у чего нет безопасного адреса, отбрасывается: без адреса вложение всё
 * равно не открыть, а строка-заглушка в списке файлов выглядит как поломка.
 * Признаки картинки и видео берутся из данных, но проверяются и по расширению —
 * старые записи их не проставляли, и видео уезжало в общий список файлов.
 */
export function parseNewsAttachments(raw: unknown): NewsAttachment[] {
  if (!Array.isArray(raw)) return [];
  const list: NewsAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = safeMediaUrl(record.url);
    if (!url) continue;
    const type = typeof record.type === "string" ? record.type : "";
    const isImage = record.isImage === true || type.startsWith("image/") || IMAGE_EXT.test(url);
    const isVideo = !isImage && (record.isVideo === true || type.startsWith("video/") || VIDEO_EXT.test(url));
    const size = typeof record.size === "number" && Number.isFinite(record.size) && record.size > 0 ? record.size : 0;
    list.push({
      url,
      name: typeof record.name === "string" && record.name.trim() ? record.name : "Файл",
      size,
      type,
      isImage,
      isVideo,
    });
  }
  return list;
}

/**
 * Картинка карточки: своя обложка, иначе первая картинка из вложений.
 *
 * Заглушки на случай «ничего нет» нарочно не возвращаем. Серый прямоугольник с
 * иконкой занимает столько же места, сколько настоящая обложка, и лента из
 * текстовых новостей превращается в лестницу из пустых квадратов.
 */
export function postCover(post: NewsPost): string | null {
  const own = safeMediaUrl(post.cover);
  if (own) return own;
  return parseNewsAttachments(post.attachments).find((a) => a.isImage)?.url ?? null;
}

/** Сколько знаков текста уходит в карточку. */
export const CARD_EXCERPT_LIMIT = 300;

/**
 * Три строки выжимки на узком экране — это примерно столько знаков. Порог нужен
 * не для обрезки (её делает CSS), а чтобы решить, врать ли ссылкой «Читать
 * далее»: под коротким постом за ней ровно то же, что человек уже прочитал.
 */
const CARD_VISIBLE_CHARS = 140;

/**
 * Текст поста для карточки: без разметки, в одну строку.
 *
 * Разметку снимаем, а не показываем через renderContent, по двум причинам.
 * Первая: карточка — одна большая цель нажатия, и ссылка или упоминание внутри
 * неё перехватывали бы касание, промахнуться пальцем по такому очень легко.
 * Вторая: обрезка по трём строкам может прийтись на середину пары «звёздочек»,
 * и хвост карточки уходил бы в курсив до конца ленты.
 *
 * Блоки кода выбрасываются целиком: в одну строку без отступов они всё равно
 * нечитаемы, а место занимают всё.
 */
export function postExcerpt(content: string, limit: number = CARD_EXCERPT_LIMIT): string {
  if (!content) return "";
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[ \t]*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= limit) return plain;
  const cut = plain.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  /* Режем по границе слова, но только если слово не занимает всю выжимку:
     на сплошной строке без пробелов (ссылка, набор) резать было бы негде. */
  const body = space > limit * 0.6 ? cut.slice(0, space) : cut;
  return `${body.trimEnd()}…`;
}

/** Есть ли под выжимкой что-то, ради чего стоит открывать пост. */
export function hasMoreToRead(content: string): boolean {
  return postExcerpt(content).length > CARD_VISIBLE_CHARS;
}

/**
 * Русское склонение по числу: 1 → one, 2–4 → few, остальное (и 11–14) → many.
 *
 * Своя копия, потому что такая же в lib/username.ts наружу не выведена.
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Просмотры сокращённо.
 *
 * Округляем вниз, а не по правилам: 1999 просмотров, показанных как «2 тыс.»,
 * — это приписанная сотня, которой не было. Вниз ошибка всегда в свою пользу.
 */
export function formatViews(views: number): string {
  if (!Number.isFinite(views) || views <= 0) return "0";
  const value = Math.floor(views);
  if (value < 1000) return String(value);
  const million = value >= 1_000_000;
  const scaled = value / (million ? 1_000_000 : 1000);
  const rounded = scaled < 10 ? Math.floor(scaled * 10) / 10 : Math.floor(scaled);
  return `${String(rounded).replace(".", ",")} ${million ? "млн" : "тыс."}`;
}

/** Заголовок раздела комментариев. */
export function commentsTitle(count: number): string {
  if (count <= 0) return "Комментарии";
  return `${count} ${pluralRu(count, "комментарий", "комментария", "комментариев")}`;
}

/** Размер файла для строки вложения. */
export function fileSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  const mb = bytes / (1024 * 1024);
  return `${(Math.round(mb * 10) / 10).toString().replace(".", ",")} МБ`;
}

function timePart(date: Date): string {
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Дата в строке карточки.
 *
 * Сегодняшнее и вчерашнее — со временем: в ленте новостей важно, утром это
 * вышло или час назад. Дальше время только мешает, а год показывается лишь
 * тогда, когда он не нынешний: «5 августа 2026» весь 2026 год — лишний шум.
 *
 * Часы «N ч. назад» (lib/timeAgo) здесь не годятся: они меняются, пока экран
 * открыт, а рядом стоит счётчик просмотров — вместе это читается как живое
 * обновление, которого нет.
 */
export function formatPostDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (sameDay(date, now)) return `сегодня, ${timePart(date)}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return `вчера, ${timePart(date)}`;
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Дата со временем — для отложенного выхода и подписи под заголовком. */
export function formatPostDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day}, ${timePart(date)}`;
}

/**
 * Метка состояния поста. Такой пост виден только автору (сервер чужим его не
 * отдаёт), но сам автор без метки не отличит черновик от опубликованного и
 * будет ждать откликов на то, чего никто не видел.
 */
export type PostMark = "draft" | "scheduled" | null;

export function postMark(post: NewsPost, now: number = Date.now()): PostMark {
  if (post.draft) return "draft";
  if (post.publishAt && new Date(post.publishAt).getTime() > now) return "scheduled";
  return null;
}
