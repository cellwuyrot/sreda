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
  /** FIX-BOARDPICKER: конкретный холст назначения (id борда внутри рабочей среды). */
  boardId?: string;
  /**
   * FIX-BOARDTARGET: canvas-канал, чью рабочую среду выбрали в пикере.
   *
   * Область («личная» или «групповая») отвечает лишь на вопрос, чей это холст,
   * а canvas-каналов в сообществе бывает несколько. Без адреса канала элемент
   * забирал тот групповой холст, который в этот момент открыт, — то есть выбор
   * в пикере ни на что не влиял.
   */
  targetChannelId?: string;
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
  /** FIX-BOARDPICKER: конкретный холст назначения. */
  boardId?: string;
  /** FIX-BOARDPICKER: явное указание области; иначе выводится из channelId. */
  scope?: BoardScope;
  /** FIX-BOARDTARGET: canvas-канал выбранной рабочей среды. */
  targetChannelId?: string;
}): BoardInboxItem {
  const item: BoardInboxItem = {
    id: `bi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "message",
    createdAt: new Date().toISOString(),
    ...input,
    /* Канал передаёт только групповой чат; у личных сообщений канала нет,
       и именно по этому признаку разводим области. */
    scope: input.scope ?? (input.channelId ? "group" : "personal"),
    boardId: input.boardId,
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
 * FIX-BOARDTARGET: этому ли холсту адресован элемент.
 *
 * Область совпала — необходимое условие, но не достаточное: canvas-каналов в
 * сообществе бывает несколько, и элемент с адресом канала берёт только он.
 * Элемент без адреса (личная среда, старая очередь) остаётся «для любого своей
 * области» — иначе накопленное до этой правки уже никто бы не забрал.
 */
export function boardItemMatches(
  item: BoardInboxItem,
  scope?: BoardScope,
  channelId?: string | null,
): boolean {
  if (scope && boardItemScope(item) !== scope) return false;
  if (item.targetChannelId && item.targetChannelId !== channelId) return false;
  return true;
}

/**
 * Забрать накопившееся для СВОЕГО холста (вызывается при его открытии).
 *
 * Чужие элементы ОСТАЮТСЯ в очереди и дождутся своего холста: выбросить их
 * значило бы терять то, что человек уже отправил.
 */
export function drainBoardInbox(scope?: BoardScope, channelId?: string | null): BoardInboxItem[] {
  const queue = readQueue();
  const mine = queue.filter((i) => boardItemMatches(i, scope, channelId));
  writeQueue(queue.filter((i) => !boardItemMatches(i, scope, channelId)));
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
  channelId?: string | null,
): () => void {
  if (typeof window === "undefined") return () => {};

  const onLocal = (e: Event) => {
    const item = (e as CustomEvent<BoardInboxItem>).detail;
    if (!item) return;
    /* Чужой элемент не трогаем и из очереди НЕ убираем. */
    if (!boardItemMatches(item, scope, channelId)) return;
    writeQueue(readQueue().filter((i) => i.id !== item.id));
    cb(item);
  };

  // Другая вкладка положила элемент в очередь → забираем своё накопившееся.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== LS_KEY) return;
    drainBoardInbox(scope, channelId).forEach(cb);
  };

  window.addEventListener(EVENT_NAME, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}
