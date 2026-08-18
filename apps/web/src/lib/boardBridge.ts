/**
 * boardBridge — мост «чат → рабочая среда (канвас)».
 *
 * Кнопка «Отправить на доску» в hover-тулбаре сообщения кладёт элемент в
 * очередь. Если канвас смонтирован — он получает элемент мгновенно через
 * CustomEvent; если нет — элемент ждёт в localStorage и забирается при
 * следующем открытии доски (drainBoardInbox). Работает и между вкладками
 * (событие `storage`).
 *
 * Никаких изменений в БД/Prisma не требуется: карточка создаётся штатным
 * механизмом самого канваса (см. BoardInboxListener.tsx и PATCHES.md).
 */

/**
 * FIX-BOARDSCOPE: куда нести элемент.
 *
 * Очередь была одна на все холсты, и забирал её тот, кто в этот момент открыт.
 * Поэтому сообщение из личной переписки могло попасть на ОБШИЙ холст группы —
 * то есть личная переписка утекала туда, где её видят участники. Теперь у каждого
 * элемента есть область, и холст берёт только своё:
 *
 *   • "personal" — из личных сообщений (без канала) → личная рабочая среда;
 *   • "group"    — из канала группы → общая рабочая среда группы.
 *
 * Старые элементы без метки считаются личными: своя доска — безопасный по умолчанию выбор.
 */
export type BoardScope = "personal" | "group";

export type BoardInboxItem = {
  id: string;
  type: "message";
  /** FIX-BOARDSCOPE: чей это холст — личный или групповой. */
  scope?: BoardScope;
  /** Текст сообщения */
  content: string;
  authorName?: string;
  channelName?: string;
  channelId?: string;
  messageId?: string;
  /** ISO-время попадания в очередь */
  createdAt: string;
};

const LS_KEY = "tz-board-inbox";
const EVENT_NAME = "tz-board-inbox";
const MAX_QUEUE = 100;

function readQueue(): BoardInboxItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: BoardInboxItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    /* квота localStorage — не критично */
  }
}

/** Отправить сообщение на доску (вызывается из hover-тулбара). */
export function sendMessageToBoard(input: {
  content: string;
  authorName?: string;
  channelName?: string;
  channelId?: string;
  messageId?: string;
}): BoardInboxItem {
  const item: BoardInboxItem = {
    id: `bi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "message",
    createdAt: new Date().toISOString(),
    ...input,
    /* Канал передаёт только групповой чат; у личных сообщений канала нет,
       и именно по этому признаку разводим области. */
    scope: input.channelId ? "group" : "personal",
  };
  writeQueue([...readQueue(), item]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<BoardInboxItem>(EVENT_NAME, { detail: item }));
  }
  return item;
}

/** Область элемента. Без метки (старая очередь) — личная. */
export function boardItemScope(item: BoardInboxItem): BoardScope {
  return item.scope ?? "personal";
}

/**
 * Забрать накопившееся для СВОЕЙ области (вызывается при открытии доски).
 *
 * Чужие по области элементы ОСТАЮТСЯ в очереди и дождутся своего холста:
 * выбросить их значило бы терять то, что человек уже отправил.
 */
export function drainBoardInbox(scope?: BoardScope): BoardInboxItem[] {
  const queue = readQueue();
  if (!scope) {
    writeQueue([]);
    return queue;
  }
  const mine = queue.filter((i) => boardItemScope(i) === scope);
  writeQueue(queue.filter((i) => boardItemScope(i) !== scope));
  return mine;
}

/** Посмотреть очередь, не очищая её (для бейджа «N новых»). */
export function peekBoardInbox(): BoardInboxItem[] {
  return readQueue();
}

/**
 * Подписка канваса на новые элементы. Подписчик «забирает» элемент —
 * он сразу удаляется из очереди, чтобы не задвоился при следующем drain.
 * Возвращает функцию отписки.
 */
export function subscribeBoardInbox(
  cb: (item: BoardInboxItem) => void,
  scope?: BoardScope,
): () => void {
  if (typeof window === "undefined") return () => {};

  const onLocal = (e: Event) => {
    const item = (e as CustomEvent<BoardInboxItem>).detail;
    if (!item) return;
    /* Чужой элемент не трогаем и из очереди НЕ убираем. */
    if (scope && boardItemScope(item) !== scope) return;
    writeQueue(readQueue().filter((i) => i.id !== item.id));
    cb(item);
  };

  // Другая вкладка положила элемент в очередь → забираем своё накопившееся.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== LS_KEY) return;
    drainBoardInbox(scope).forEach(cb);
  };

  window.addEventListener(EVENT_NAME, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}
