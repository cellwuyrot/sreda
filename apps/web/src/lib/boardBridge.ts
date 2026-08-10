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

export type BoardInboxItem = {
  id: string;
  type: "message";
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
  };
  writeQueue([...readQueue(), item]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<BoardInboxItem>(EVENT_NAME, { detail: item }));
  }
  return item;
}

/** Забрать и очистить накопившуюся очередь (вызывается при открытии доски). */
export function drainBoardInbox(): BoardInboxItem[] {
  const queue = readQueue();
  writeQueue([]);
  return queue;
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
export function subscribeBoardInbox(cb: (item: BoardInboxItem) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onLocal = (e: Event) => {
    const item = (e as CustomEvent<BoardInboxItem>).detail;
    if (!item) return;
    writeQueue(readQueue().filter((i) => i.id !== item.id));
    cb(item);
  };

  // Другая вкладка положила элемент в очередь → забираем всё накопившееся.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== LS_KEY) return;
    drainBoardInbox().forEach(cb);
  };

  window.addEventListener(EVENT_NAME, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}
