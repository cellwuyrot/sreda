/**
 * MAIL-HISTORY: сборка параметров запроса истории ящика.
 *
 * Вынесено из экрана `/admin/mail` отдельно от React специально ради
 * тестируемости: именно здесь решается, что уходит в базу, а что нет. Раньше
 * решения не было вовсе — поиск и фильтр папки применялись к уже загруженным
 * строкам, и «поиск по ящику» искал среди первых десяти писем, а на вкладке
 * «Архив» направление вообще не передавалось.
 */

/** Направление письма в листинге (совпадает с MailDirection на сервере). */
export type MailListDirection = "incoming" | "outgoing";

/** Вкладка списка: направление либо архив. */
export type MailListTab = MailListDirection | "archive" | "trash";

/** Фильтр папки — сохранённый набор условий (см. /api/admin/mail/folders). */
export interface MailListFolderFilter {
  direction?: string;
  fromContains?: string;
  toContains?: string;
  subjectContains?: string;
}

export interface MailListQuery {
  tab: MailListTab;
  /** Направление внутри архива: "" — оба. */
  archiveDir: MailListDirection | "";
  /** Строка поиска (уже обрезанная). */
  query: string;
  folder: MailListFolderFilter | null;
  offset: number;
  limit: number;
}

/**
 * Собрать query-string для GET /api/admin/mail/[address].
 *
 * Направление вкладки главнее направления папки: иначе папка «исходящие» на
 * вкладке «Входящие» давала бы всегда пустой список. Направление папки
 * применяется только там, где вкладка его не задаёт, — в архиве «Все».
 */
export function listingParams(args: MailListQuery): string {
  const p = new URLSearchParams();

  if (args.tab === "trash") {
    p.set("trashed", "1");
  } else if (args.tab === "archive") {
    p.set("archived", "1");
    if (args.archiveDir) p.set("direction", args.archiveDir);
  } else {
    p.set("direction", args.tab);
  }

  const query = args.query.trim();
  if (query) p.set("q", query);

  const f = args.folder;
  if (f) {
    const folderDirection = f.direction === "incoming" || f.direction === "outgoing" ? f.direction : "";
    if (folderDirection && (args.tab === "archive" || args.tab === "trash") && !args.archiveDir) p.set("direction", folderDirection);
    if (f.fromContains) p.set("from", f.fromContains);
    if (f.toContains) p.set("to", f.toContains);
    if (f.subjectContains) p.set("subject", f.subjectContains);
  }

  p.set("offset", String(Math.max(0, Math.trunc(args.offset))));
  p.set("limit", String(Math.max(1, Math.trunc(args.limit))));
  return p.toString();
}
