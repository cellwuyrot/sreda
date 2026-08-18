/**
 * FIX-FWDBUF: внутренний буфер пересылки сообщений.
 *
 * Было: кнопка «Переслать» открывала окно со списком каналов и диалогов. Список
 * — плохой способ выбрать место: в нём нет ни контекста беседы, ни порядка,
 * привычного человеку в боковой панели.
 *
 * Стало: сообщение кладётся во внутренний буфер (одно место на весь проект),
 * человек видит подсказку «выберите получателя» и сам переходит туда, куда хочет —
 * в любой чат или ЛС. Там над полем ввода ждёт полоса «Переслать сюда».
 *
 * Буфер один и живёт в localStorage — поэтому переход между разделами (и даже
 * перезагрузка страницы) его не теряет. Второго сообщения в буфере не бывает:
 * «переслать» — действие на один раз, а не корзина.
 */

export type ForwardItem = {
  id: string;
  /** Текст исходного сообщения. */
  content: string;
  /** Кто автор исходного сообщения. */
  userName: string;
  /** Вложения в том же виде, в каком их хранит сообщение (JSON-строка). */
  attachments?: string | null;
  createdAt: string;
};

const LS_KEY = "tz-forward-buffer";
const EVENT_NAME = "tz-forward-buffer";

/**
 * Метка пересланного сообщения в его тексте.
 *
 * Почему метка в тексте, а не поле в базе: пересылка работает сразу в четырёх
 * местах (каналы, ЛС, ветки, избранное) и идёт через два разных маршрута
 * отправки. Новое поле потребовало бы миграции и правки всех маршрутов сразу,
 * а старые сообщения всё равно остались бы без него. Метка же читаема человеком
 * даже там, где оформление не применяется (уведомления, поиск, экспорт).
 */
export const FORWARD_MARK = "⤴ Переслано от ";

function read(): ForwardItem | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ForwardItem;
    return parsed && typeof parsed.content === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function emit(item: ForwardItem | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ForwardItem | null>(EVENT_NAME, { detail: item }));
}

/** Положить сообщение в буфер пересылки. */
export function putForward(input: {
  content: string;
  userName: string;
  attachments?: string | null;
}): ForwardItem {
  const item: ForwardItem = {
    id: `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    content: input.content ?? "",
    userName: input.userName ?? "",
    attachments: input.attachments ?? null,
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(item));
    } catch {
      /* квота localStorage — не критично, полоса появится по событию */
    }
  }
  emit(item);
  return item;
}

/** Что сейчас ждёт пересылки. */
export function peekForward(): ForwardItem | null {
  return read();
}

/** Отменить пересылку / очистить буфер после отправки. */
export function clearForward(): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* игнорируем */
    }
  }
  emit(null);
}

/** Подписка на состояние буфера (текущая и соседние вкладки). */
export function subscribeForward(cb: (item: ForwardItem | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onLocal = (e: Event) => cb((e as CustomEvent<ForwardItem | null>).detail ?? null);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== LS_KEY) return;
    cb(read());
  };
  window.addEventListener(EVENT_NAME, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

/** Текст для отправки: первая строка — откуда, дальше сам текст. */
export function formatForwarded(item: ForwardItem): string {
  const author = (item.userName || "неизвестного").replace(/[\r\n]+/g, " ").slice(0, 120);
  return `${FORWARD_MARK}${author}:\n${item.content ?? ""}`;
}

/**
 * Разобрать пересланное сообщение. `null` — сообщение обычное.
 */
export function parseForwarded(text: string): { author: string; body: string } | null {
  if (!text.startsWith(FORWARD_MARK)) return null;
  const nl = text.indexOf("\n");
  const head = (nl === -1 ? text : text.slice(0, nl)).slice(FORWARD_MARK.length);
  const author = head.endsWith(":") ? head.slice(0, -1) : head;
  const body = nl === -1 ? "" : text.slice(nl + 1);
  return { author: author.trim(), body };
}
