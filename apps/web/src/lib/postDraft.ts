/**
 * POSTDRAFT: черновик поста новостного канала и проверки перед отправкой.
 *
 * ── Зачем отдельный модуль ──────────────────────────────────────────────────
 *
 * Пост в новостях — это не реплика в чате: его пишут двадцать минут, а не
 * двадцать секунд. Всё это время текст живёт только в состоянии React, то есть
 * ровно до первого промаха: закрыли вкладку, нажали «назад» на телефоне,
 * браузер выгрузил фоновую вкладку по нехватке памяти — и написанного нет.
 * После второго такого случая длинные посты просто перестают писать, а пишут
 * короткие в чат. Поэтому набранное дублируется в localStorage.
 *
 * Здесь только чистая часть — ключи, срок жизни, проверки и правила вставки
 * разметки. Загрузка файлов, отрисовка и запросы к серверу остаются в
 * компоненте: правило, которое нельзя проверить тестом, рано или поздно
 * начинает врать.
 *
 * ── Почему проверка времени повторена, а не взята из lib/reminders ──────────
 *
 * Правило совпадает буквально («в будущем, но не дальше года»), но смысл разный:
 * там срабатывание напоминания, здесь публикация. Импорт ради одной строки
 * связал бы напоминания на карточках досок с новостной лентой — и любое
 * изменение предела в одном месте молча меняло бы поведение другого.
 */

/** Заголовок поста. Длиннее не помещается ни в карточку ленты, ни в анонс. */
export const MAX_POST_TITLE = 200;

/**
 * За сколько знаков до предела показывать счётчик остатка.
 *
 * Постоянный счётчик у поля — шум: он висит перед глазами всё время, пока в нём
 * нет нужды. Появляясь на последних сорока знаках, он сообщает ровно то, что
 * человеку в этот момент важно: сколько ещё можно.
 */
export const TITLE_COUNTER_TAIL = 40;

/** Дальше года вперёд публикацию ставить бессмысленно — это промах в годе. */
export const MAX_PUBLISH_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Сколько живёт черновик.
 *
 * Неделя — граница между «случайно закрыл» и «забыл». Текст недельной давности
 * воскрешать опаснее, чем потерять: человек садится писать новое, а поле уже
 * занято чем-то старым, и он либо публикует смесь, либо всё стирает вручную.
 */
export const POST_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Версия формата хранения. Меняется, когда меняется набор полей: чужой формат
 * лучше выбросить целиком, чем разбирать наполовину и подставить в поля мусор.
 */
export const POST_DRAFT_VERSION = 1;

/** Вложение поста в том виде, в каком его отдаёт /api/messages/upload. */
export interface PostAttachment {
  url: string;
  name: string;
  size: number;
  type: string;
  isImage: boolean;
  isVideo?: boolean;
  isVoice?: boolean;
  duration?: number;
}

/** Всё, что человек набрал, но ещё не отправил. */
export interface PostDraft {
  title: string;
  content: string;
  /** Адрес обложки в хранилище (или null, если её не выбрали). */
  cover: string | null;
  attachments: PostAttachment[];
  commentsClosed: boolean;
  /** Отложенная публикация, метка времени. */
  publishAt: number | null;
}

/** Пустая заготовка — начальное состояние редактора. */
export function emptyDraft(): PostDraft {
  return { title: "", content: "", cover: null, attachments: [], commentsClosed: false, publishAt: null };
}

/* ── Хранение ─────────────────────────────────────────────────────────────── */

/** Ключ черновика. Свой на каждый канал: посты в разные каналы не смешиваются. */
export function postDraftKey(channelId: string): string {
  return `tz-news-draft:${channelId}`;
}

/**
 * Доступ к хранилищу.
 *
 * `typeof` вместо прямого обращения — на сервере (SSR) переменной нет вовсе, и
 * обычное чтение упало бы ReferenceError ещё до отрисовки. Обращение обёрнуто в
 * try: в приватном режиме Safari и при запрете сторонних данных сам доступ к
 * localStorage бросает исключение. Потеря черновика — неприятность, падение
 * редактора — потеря всего написанного.
 */
function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

interface StoredDraft extends PostDraft {
  v: number;
  savedAt: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Черновик считается пустым, когда возвращать нечего.
 *
 * Заголовок здесь учитывается, а в `isPostEmpty` — нет, и это намеренно.
 * Опубликовать один заголовок нельзя, но набранный заголовок — уже работа, и
 * терять её при перезагрузке так же обидно, как текст. Переключатель
 * комментариев и время публикации сами по себе воскрешения не стоят: это не
 * написанное, а настройки, которые проще выставить заново.
 */
export function isDraftEmpty(draft: PostDraft): boolean {
  return isPostEmpty(draft) && draft.title.trim() === "";
}

/**
 * Сохранить черновик.
 *
 * Пустой черновик не хранится, а стирает прежний: иначе после отправки или
 * очистки полей в хранилище оставался бы предыдущий текст и всплывал бы при
 * следующем открытии редактора.
 */
export function writeDraft(channelId: string, draft: PostDraft, now: number = Date.now()): void {
  const store = storage();
  if (!store) return;
  if (isDraftEmpty(draft)) {
    clearDraft(channelId);
    return;
  }
  const stored: StoredDraft = { ...draft, v: POST_DRAFT_VERSION, savedAt: now };
  try {
    store.setItem(postDraftKey(channelId), JSON.stringify(stored));
  } catch {
    /* Квота переполнена или запись запрещена — молча живём дальше без черновика:
       ронять редактор из-за резервной копии нельзя. */
  }
}

/**
 * Прочитать черновик. null — черновика нет, он чужого формата или протух.
 *
 * Протухший и битый черновик здесь же удаляются: иначе они лежали бы в
 * хранилище вечно, а каждое открытие редактора заново тратило бы разбор JSON на
 * то, что всё равно отброшено.
 */
export function readDraft(channelId: string, now: number = Date.now()): PostDraft | null {
  const store = storage();
  if (!store) return null;

  let raw: string | null = null;
  try {
    raw = store.getItem(postDraftKey(channelId));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearDraft(channelId);
    return null;
  }

  if (!isPlainObject(parsed) || parsed.v !== POST_DRAFT_VERSION || typeof parsed.savedAt !== "number") {
    clearDraft(channelId);
    return null;
  }
  if (!Number.isFinite(parsed.savedAt) || now - parsed.savedAt > POST_DRAFT_TTL_MS) {
    clearDraft(channelId);
    return null;
  }

  /* Каждое поле приводится к своему типу отдельно. Хранилище правится руками из
     консоли и переживает выкладки: половина полей может быть от прошлой версии
     формата, и подставить `undefined` в текстовое поле — это неуправляемый
     компонент и потерянный ввод. */
  const draft: PostDraft = {
    title: typeof parsed.title === "string" ? parsed.title : "",
    content: typeof parsed.content === "string" ? parsed.content : "",
    cover: typeof parsed.cover === "string" && parsed.cover ? parsed.cover : null,
    attachments: Array.isArray(parsed.attachments)
      ? (parsed.attachments.filter((a) => isPlainObject(a) && typeof a.url === "string") as PostAttachment[])
      : [],
    commentsClosed: parsed.commentsClosed === true,
    publishAt: typeof parsed.publishAt === "number" && Number.isFinite(parsed.publishAt) ? parsed.publishAt : null,
  };

  if (isDraftEmpty(draft)) {
    clearDraft(channelId);
    return null;
  }
  return draft;
}

/** Забыть черновик — после успешной отправки или по кнопке «очистить». */
export function clearDraft(channelId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(postDraftKey(channelId));
  } catch {
    /* см. writeDraft */
  }
}

/* ── Проверки перед отправкой ─────────────────────────────────────────────── */

/**
 * Пустой ли пост.
 *
 * Заголовок в счёт не идёт: в ленте пост открывают ради содержимого, и запись
 * из одного заголовка выглядит поломкой, а не сообщением. Обложка и вложение
 * считаются содержимым — пост из одной картинки осмыслен.
 */
export function isPostEmpty(input: {
  content?: string | null;
  cover?: string | null;
  attachments?: readonly unknown[] | null;
}): boolean {
  if (typeof input.content === "string" && input.content.trim() !== "") return false;
  if (typeof input.cover === "string" && input.cover.trim() !== "") return false;
  if (input.attachments && input.attachments.length > 0) return false;
  return true;
}

/** Заголовок как его увидит сервер: без краёв и не длиннее предела. */
export function normalizeTitle(title: unknown): string {
  const text = typeof title === "string" ? title.trim() : "";
  /* Обрез может прийтись на пробел — хвостовой пробел в заголовке ленты потом
     видно как лишний отступ перед многоточием. */
  return text.slice(0, MAX_POST_TITLE).trimEnd();
}

/**
 * Сколько знаков осталось, или null — пока до предела далеко и счётчик не нужен.
 */
export function titleRemaining(title: string): number | null {
  const left = MAX_POST_TITLE - title.length;
  return left <= TITLE_COUNTER_TAIL ? left : null;
}

/**
 * Годится ли время отложенной публикации.
 *
 * Прошлое отклоняется: пост опубликуется в первый же обход планировщика, то
 * есть «отложенная» публикация окажется немедленной — а человек рассчитывал на
 * другое и узнает об этом уже из ленты.
 */
export function isValidPublishAt(value: unknown, now: number = Date.now()): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return value > now && value <= now + MAX_PUBLISH_AHEAD_MS;
}

/** Что уходит на сервер: POST /api/channels/:id/posts и PATCH /api/posts/:id. */
export interface PostPayload {
  title: string;
  content: string;
  cover: string | null;
  attachments: PostAttachment[];
  draft: boolean;
  publishAt: number | null;
  commentsClosed: boolean;
}

export interface PostInput {
  title?: string | null;
  content?: string | null;
  cover?: string | null;
  attachments?: PostAttachment[] | null;
  commentsClosed?: boolean;
  publishAt?: number | null;
  draft?: boolean;
}

export type PostCheck = { ok: true; payload: PostPayload } | { ok: false; error: string };

/**
 * Проверка перед отправкой. Возвращает либо готовое тело запроса, либо текст
 * ошибки для показа рядом с кнопкой.
 *
 * Проверка живёт здесь, а не в компоненте, ровно потому, что она одна на три
 * кнопки — «сохранить черновик», «опубликовать» и «опубликовать позже» — и на
 * два маршрута (создание и правка). Разъехавшись по местам вызова, такие
 * правила расходятся: где-то перестают обрезать заголовок, где-то пропускают
 * пустой пост.
 */
export function validatePost(input: PostInput, now: number = Date.now()): PostCheck {
  const draft = input.draft === true;
  const title = normalizeTitle(input.title);
  const content = typeof input.content === "string" ? input.content.trim() : "";
  const cover = typeof input.cover === "string" && input.cover ? input.cover : null;
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];

  if (isPostEmpty({ content, cover, attachments })) {
    /* Черновик с одним заголовком сохранить можно: это отложенная заготовка
       («напишу вечером»), и отказывать в ней — значит заставлять держать
       название в голове. Публиковать такое нельзя: в ленте это пустая карточка. */
    if (!draft || title === "") {
      return { ok: false, error: "Пост пустой: добавьте текст, обложку или вложение" };
    }
  }

  let publishAt: number | null = null;
  if (input.publishAt !== null && input.publishAt !== undefined) {
    if (typeof input.publishAt !== "number" || !Number.isFinite(input.publishAt)) {
      return { ok: false, error: "Не удалось разобрать время публикации" };
    }
    if (input.publishAt <= now) {
      return { ok: false, error: "Время публикации уже прошло — выберите будущее" };
    }
    if (input.publishAt > now + MAX_PUBLISH_AHEAD_MS) {
      return { ok: false, error: "Дальше чем на год вперёд публикация не ставится" };
    }
    publishAt = input.publishAt;
  }

  return {
    ok: true,
    payload: {
      title,
      content,
      cover,
      attachments,
      draft,
      publishAt,
      commentsClosed: input.commentsClosed === true,
    },
  };
}

/**
 * Дата и время из двух полей формы в метку времени.
 *
 * Строка собирается без указания зоны — браузер понимает такую запись как
 * местное время. Это то, чего человек и ждёт: он выбирает «завтра в 9:00» по
 * своим часам, а не по UTC.
 */
export function publishAtFromInputs(date: string, time: string): number | null {
  if (!date) return null;
  const value = new Date(`${date}T${time || "00:00"}`).getTime();
  return Number.isFinite(value) ? value : null;
}

/** Обратное преобразование — чтобы у существующего поста поля были заполнены. */
export function publishAtToInputs(value: number | null | undefined): { date: string; time: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) return { date: "", time: "" };
  const at = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

/* ── Вставка разметки ─────────────────────────────────────────────────────── */

export type PostFormat = "bold" | "italic" | "heading" | "quote" | "list" | "code" | "link";

/** Новый текст поля и куда после вставки поставить курсор или выделение. */
export interface FormatResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Парные знаки: оборачивают выделенный кусок. */
const WRAP_MARK: Record<"bold" | "italic" | "code", string> = { bold: "**", italic: "*", code: "`" };

/** Построчные знаки: ставятся в начало строки (см. messageFormat). */
const LINE_MARK: Record<"heading" | "quote" | "list", string> = { heading: "## ", quote: "> ", list: "- " };

/** Заготовка адреса. Разметка ссылок в проекте не нужна — адрес сам становится ссылкой. */
const LINK_STUB = "https://";

function lineStartAt(text: string, index: number): number {
  if (index <= 0) return 0;
  return text.lastIndexOf("\n", index - 1) + 1;
}

function lineEndAt(text: string, index: number): number {
  const nl = text.indexOf("\n", index);
  return nl === -1 ? text.length : nl;
}

function wrap(text: string, start: number, end: number, mark: string): FormatResult {
  const selected = text.slice(start, end);
  /* Повторное нажатие снимает разметку. Без этого кнопка работает только в одну
     сторону: выделили уже жирный кусок, промахнулись — и получили `****текст****`,
     который в ленте выводится звёздочками. */
  if (selected.length > mark.length * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(mark.length, selected.length - mark.length);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }
  return {
    text: text.slice(0, start) + mark + selected + mark + text.slice(end),
    /* Выделения не было — курсор встаёт МЕЖДУ знаками, чтобы можно было сразу
       печатать. Иначе человек набирает текст после закрывающих звёздочек и
       видит их в ленте как есть. */
    selectionStart: start + mark.length,
    selectionEnd: start + mark.length + selected.length,
  };
}

function linePrefix(text: string, start: number, end: number, mark: string, firstLineOnly: boolean): FormatResult {
  const from = lineStartAt(text, start);
  const to = firstLineOnly ? lineEndAt(text, from) : lineEndAt(text, Math.max(start, end));
  const block = text.slice(from, Math.max(from, to));
  const lines = block.split("\n");

  const filled = lines.filter((line) => line.trim() !== "");
  let next: string[];
  if (filled.length === 0) {
    // Курсор на пустой строке: ставим знак и даём печатать дальше.
    next = [mark + lines[0], ...lines.slice(1)];
  } else if (filled.every((line) => line.startsWith(mark))) {
    // Все строки уже помечены — второе нажатие снимает пометку.
    next = lines.map((line) => (line.startsWith(mark) ? line.slice(mark.length) : line));
  } else {
    /* Пустые строки пропускаем: `> ` без текста в ленте выводится как есть —
       правило разметки требует после знака хотя бы один символ. */
    next = lines.map((line) => (line.trim() === "" || line.startsWith(mark) ? line : mark + line));
  }

  const nextBlock = next.join("\n");
  const result = text.slice(0, from) + nextBlock + text.slice(Math.max(from, to));
  if (start === end) {
    const shift = next[0].length - lines[0].length;
    const caret = Math.max(from, start + shift);
    return { text: result, selectionStart: caret, selectionEnd: caret };
  }
  return { text: result, selectionStart: from, selectionEnd: from + nextBlock.length };
}

function codeFence(text: string, start: number, end: number): FormatResult {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  /* Открывающие кавычки должны стоять на своей строке, иначе первая строка кода
     прилипнет к предыдущему абзацу и блок не распознается. */
  const lead = before && !before.endsWith("\n") ? "\n" : "";
  const opened = `${lead}\`\`\`\n`;
  return {
    text: `${before}${opened}${selected}\n\`\`\`\n${text.slice(end)}`,
    selectionStart: before.length + opened.length,
    selectionEnd: before.length + opened.length + selected.length,
  };
}

function insertLink(text: string, start: number, end: number): FormatResult {
  const selected = text.slice(start, end).trim();
  /* Выделили готовый адрес — трогать нечего: он и так станет ссылкой. Вставка
     ещё одной заготовки рядом только сломала бы разбор. */
  if (/^(https?:\/\/|www\.)\S+$/.test(selected)) {
    return { text, selectionStart: start, selectionEnd: end };
  }
  const before = text.slice(0, end);
  const space = before && !/\s$/.test(before) ? " " : "";
  const caret = before.length + space.length + LINK_STUB.length;
  return {
    text: `${before}${space}${LINK_STUB}${text.slice(end)}`,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

/**
 * Что сделать с текстом по нажатию кнопки панели форматирования.
 *
 * Панель не WYSIWYG: она вставляет ту же разметку, которую можно набрать
 * руками, — иначе редактор и лента разъехались бы в разных представлениях
 * текста. Правило вынесено из компонента, потому что промахи здесь молчаливые:
 * знак встал не туда, а видно это только в опубликованном посте.
 *
 * Границы выделения приходят из DOM и в теории могут прийти любыми (перевёрнутыми,
 * за пределами текста) — приводим их в порядок здесь, а не в четырёх местах вызова.
 */
export function applyFormat(text: string, selectionStart: number, selectionEnd: number, format: PostFormat): FormatResult {
  const limit = text.length;
  const a = Math.min(Math.max(Number.isFinite(selectionStart) ? selectionStart : limit, 0), limit);
  const b = Math.min(Math.max(Number.isFinite(selectionEnd) ? selectionEnd : a, 0), limit);
  const start = Math.min(a, b);
  const end = Math.max(a, b);

  switch (format) {
    case "bold":
    case "italic":
      return wrap(text, start, end, WRAP_MARK[format]);
    case "code":
      /* Одна кнопка на два вида кода: выделили несколько строк — это кусок
         программы, и ему нужен блок с сохранением отступов; выделили слово —
         это имя переменной, и блок вокруг него раздул бы пост на пустом месте. */
      return text.slice(start, end).includes("\n") ? codeFence(text, start, end) : wrap(text, start, end, WRAP_MARK.code);
    case "heading":
      // Подзаголовок по определению одна строка: правило разметки — `## ` и строка до конца.
      return linePrefix(text, start, end, LINE_MARK.heading, true);
    case "quote":
    case "list":
      // Цитату и список чаще ставят сразу на несколько строк — помечается каждая.
      return linePrefix(text, start, end, LINE_MARK[format], false);
    case "link":
      return insertLink(text, start, end);
  }
}
