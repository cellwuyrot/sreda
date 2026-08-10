/**
 * Внешний вид и поведение чата: то, что пользователь настраивает под себя.
 *
 * Настройки не уходят на сервер намеренно. Это свойства устройства, а не
 * аккаунта: на телефоне и на широком мониторе комфортны разные размеры и
 * разная ширина ленты. Хранятся в localStorage.
 *
 * Всё, что можно, применяется CSS-переменными на корне документа, а не через
 * пропсы. Лента сообщений — самый тяжёлый список в проекте, строки
 * мемоизированы; менять проп на каждый сдвиг ползунка значило бы перерисовывать
 * тысячи элементов. Переменная меняется в одном месте, дальше работает браузер.
 *
 * Через React проходит только то, что переменной не выразить: формат времени,
 * состав шапки сообщения и окно группировки — их читает разметка.
 */

export type ChatDensity = "compact" | "cozy" | "roomy";
export type ChatNameColor = "role" | "plain";
export type ChatTimeFormat = "24" | "12";

export interface ChatAppearance {
  /* ── Лента ─────────────────────────────────────────────────────────── */
  /** Предельная ширина строки сообщения, px. 0 — без ограничения. */
  maxWidth: number;
  /** Плотность: вертикальные отступы строки. */
  density: ChatDensity;
  /** Показывать аватары в ленте. */
  showAvatars: boolean;
  /** Размер имени автора, px. */
  authorSize: number;
  /** Насыщенность имени автора: 500 / 600 / 700. */
  authorWeight: number;
  /** Размер текста сообщения, px. */
  bodySize: number;
  /** Межстрочное расстояние текста сообщения. */
  bodyLeading: number;
  /** 24- или 12-часовое время. */
  timeFormat: ChatTimeFormat;
  /** Окно группировки подряд идущих сообщений, минуты. 0 — не группировать. */
  groupWindowMin: number;

  /* ── Имена ─────────────────────────────────────────────────────────── */
  /** Цвет имени: по роли в сообществе или единый. */
  nameColor: ChatNameColor;
  /** Показывать `@ник` рядом с именем. */
  showUsername: boolean;
  /** Показывать цветные теги ролей в ленте. */
  showRoleTags: boolean;

  /* ── Поведение ─────────────────────────────────────────────────────── */
  /** Enter отправляет сообщение; иначе перенос строки, отправка — Ctrl+Enter. */
  sendOnEnter: boolean;
  /** Следовать за новыми сообщениями, когда лента внизу. */
  autoScroll: boolean;
  /** Разворачивать ссылки в карточку с заголовком и картинкой. */
  linkPreviews: boolean;

  /* ── Приватность ───────────────────────────────────────────────────── */
  /** Сообщать серверу о прочтении — от этого зависят чужие галочки. */
  sendReadReceipts: boolean;
  /** Прятать текст сообщения в системном уведомлении. */
  hideNotificationText: boolean;
}

export const CHAT_APPEARANCE_DEFAULT: ChatAppearance = {
  maxWidth: 0,
  density: "cozy",
  showAvatars: true,
  authorSize: 15,
  authorWeight: 600,
  bodySize: 14,
  bodyLeading: 1.55,
  timeFormat: "24",
  groupWindowMin: 5,
  nameColor: "role",
  showUsername: false,
  showRoleTags: false,
  sendOnEnter: true,
  autoScroll: true,
  linkPreviews: true,
  sendReadReceipts: true,
  hideNotificationText: false,
};

const STORAGE_KEY = "tz-chat-appearance";

/** Событие о смене настроек в этой же вкладке. */
export const CHAT_APPEARANCE_EVENT = "tz-chat-appearance-change";

/** Отступы строки для каждой плотности, px. */
const DENSITY_PADDING: Record<ChatDensity, number> = {
  compact: 0,
  cozy: 2,
  roomy: 7,
};

export const MAX_WIDTH_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Во всю ширину" },
  { value: 760, label: "Узкая" },
  { value: 980, label: "Средняя" },
  { value: 1240, label: "Широкая" },
];

export const DENSITY_OPTIONS: { value: ChatDensity; label: string }[] = [
  { value: "compact", label: "Плотно" },
  { value: "cozy", label: "Обычно" },
  { value: "roomy", label: "Свободно" },
];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Приводит что угодно к валидным настройкам: в localStorage может лежать что
 * угодно, включая набор от предыдущей версии, где половины полей ещё не было.
 */
export function normalizeChatAppearance(raw: unknown): ChatAppearance {
  const d = CHAT_APPEARANCE_DEFAULT;
  if (!raw || typeof raw !== "object") return { ...d };
  const input = raw as Partial<Record<keyof ChatAppearance, unknown>>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

  return {
    maxWidth: MAX_WIDTH_OPTIONS.some((o) => o.value === num(input.maxWidth, -1))
      ? num(input.maxWidth, d.maxWidth)
      : d.maxWidth,
    density: oneOf(input.density, ["compact", "cozy", "roomy"] as const, d.density),
    showAvatars: bool(input.showAvatars, d.showAvatars),
    authorSize: clamp(num(input.authorSize, d.authorSize), 13, 19),
    authorWeight: [500, 600, 700].includes(num(input.authorWeight, 0)) ? num(input.authorWeight, d.authorWeight) : d.authorWeight,
    bodySize: clamp(num(input.bodySize, d.bodySize), 12, 18),
    bodyLeading: clamp(num(input.bodyLeading, d.bodyLeading), 1.3, 1.9),
    timeFormat: oneOf(input.timeFormat, ["24", "12"] as const, d.timeFormat),
    groupWindowMin: clamp(Math.round(num(input.groupWindowMin, d.groupWindowMin)), 0, 15),
    nameColor: oneOf(input.nameColor, ["role", "plain"] as const, d.nameColor),
    showUsername: bool(input.showUsername, d.showUsername),
    showRoleTags: bool(input.showRoleTags, d.showRoleTags),
    sendOnEnter: bool(input.sendOnEnter, d.sendOnEnter),
    autoScroll: bool(input.autoScroll, d.autoScroll),
    linkPreviews: bool(input.linkPreviews, d.linkPreviews),
    sendReadReceipts: bool(input.sendReadReceipts, d.sendReadReceipts),
    hideNotificationText: bool(input.hideNotificationText, d.hideNotificationText),
  };
}

export function loadChatAppearance(): ChatAppearance {
  if (typeof window === "undefined") return { ...CHAT_APPEARANCE_DEFAULT };
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...CHAT_APPEARANCE_DEFAULT };
    return normalizeChatAppearance(JSON.parse(stored));
  } catch {
    return { ...CHAT_APPEARANCE_DEFAULT };
  }
}

/** Ставит переменные и атрибуты на корень документа. */
export function applyChatAppearance(prefs: ChatAppearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--tz-chat-author-size", `${prefs.authorSize}px`);
  root.style.setProperty("--tz-chat-author-weight", String(prefs.authorWeight));
  root.style.setProperty("--tz-chat-body-size", `${prefs.bodySize}px`);
  root.style.setProperty("--tz-chat-body-leading", String(prefs.bodyLeading));
  root.style.setProperty("--tz-chat-row-pad", `${DENSITY_PADDING[prefs.density]}px`);
  root.style.setProperty("--tz-chat-max-width", prefs.maxWidth > 0 ? `${prefs.maxWidth}px` : "none");
  /* Атрибутом, а не переменной: скрыть колонку аватара — это правило селектора,
     а не значение свойства. */
  root.dataset.tzChatAvatars = prefs.showAvatars ? "on" : "off";
}

export function saveChatAppearance(prefs: ChatAppearance): void {
  const normalized = normalizeChatAppearance(prefs);
  applyChatAppearance(normalized);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* Приватный режим или переполненное хранилище — внешний вид уже применён. */
  }
  window.dispatchEvent(new CustomEvent(CHAT_APPEARANCE_EVENT, { detail: normalized }));
}

/**
 * Формат времени сообщения. Вынесен сюда, чтобы лента и настройки показывали
 * его одинаково и правились в одном месте.
 */
export function formatMessageTime(date: Date, format: ChatTimeFormat): string {
  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: format === "12",
  });
}
