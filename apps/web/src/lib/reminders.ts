/**
 * REMIND: напоминания на карточках рабочей среды.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Доска помнит, но не напоминает. Человек не забывает задачу — он забывает
 * ВЕРНУТЬСЯ к ней: карточка живёт, срок в ней проставлен, а увидит его тот, кто
 * откроет холст. Напоминание переворачивает это: в нужный момент оболочка сама
 * стучится в дверь, даже если холст закрыт и браузер выключен.
 *
 * ── Почему напоминание живёт на сервере, а не в карточке ────────────────────
 *
 * Карточка — это кусок JSON внутри состояния среды, и «сработать» он не может:
 * пока страница не открыта, его никто не читает. Поэтому время дублируется
 * отдельной строкой в базе, а раз в полминуты сервер проверяет, чему пора
 * сработать (см. sweeper в server.ts). В самой карточке время остаётся тоже —
 * чтобы колокольчик показывал состояние сразу, без запроса.
 *
 * Здесь — только чистая часть: заготовки сроков, проверка и подписи. Она общая
 * для кнопки на карточке и для маршрута, который принимает напоминание.
 */

/** Дальше года вперёд напоминание ставить бессмысленно. */
export const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** Заголовок в уведомлении: длиннее не помещается ни в шторку, ни в тост. */
export const MAX_REMINDER_TITLE = 120;

export type PresetId = "hour" | "evening" | "tomorrow" | "week";

export interface ReminderPreset {
  id: PresetId;
  label: string;
}

/**
 * Заготовки. Ровно четыре и в таком порядке: это перекрывает почти все случаи
 * одним нажатием, а всё остальное набирается вручную.
 */
export const REMINDER_PRESETS: ReminderPreset[] = [
  { id: "hour", label: "Через час" },
  { id: "evening", label: "Сегодня вечером" },
  { id: "tomorrow", label: "Завтра утром" },
  { id: "week", label: "Через неделю" },
];

/**
 * Во сколько сработает заготовка.
 *
 * «Вечером» — сегодня в 18:00, «утром» — завтра в 9:00. Если вечер уже прошёл,
 * заготовка переносится на завтрашний вечер: напоминание в прошлом не имеет
 * смысла и сработало бы мгновенно.
 */
export function presetTime(id: PresetId, now: number = Date.now()): number {
  const base = new Date(now);
  if (id === "hour") return now + 60 * 60 * 1000;
  if (id === "week") return now + 7 * 24 * 60 * 60 * 1000;

  const target = new Date(base);
  if (id === "evening") {
    target.setHours(18, 0, 0, 0);
    if (target.getTime() <= now) target.setDate(target.getDate() + 1);
    return target.getTime();
  }

  target.setDate(target.getDate() + 1);
  target.setHours(9, 0, 0, 0);
  return target.getTime();
}

/**
 * Годится ли время.
 *
 * Прошлое отклоняется: такое напоминание сработает в первый же обход и придёт
 * мгновенно — человек ждал другого. Слишком далёкое тоже: почти всегда это
 * промах в поле ввода года, а не намерение.
 */
export function isValidRemindAt(value: unknown, now: number = Date.now()): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return value > now && value <= now + MAX_AHEAD_MS;
}

export type ReminderState = "none" | "pending" | "fired";

/** Состояние колокольчика на карточке. */
export function reminderState(remindAt: number | null | undefined, now: number = Date.now()): ReminderState {
  if (typeof remindAt !== "number" || !Number.isFinite(remindAt)) return "none";
  return remindAt > now ? "pending" : "fired";
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Подпись под колокольчиком.
 *
 * Ближние сроки называются словами — «сегодня», «завтра», — потому что дату
 * «03.08» приходится сверять с календарём, а «завтра» понятно сразу.
 */
export function reminderLabel(remindAt: number | null | undefined, now: number = Date.now()): string {
  if (typeof remindAt !== "number" || !Number.isFinite(remindAt)) return "Напомнить";
  const date = new Date(remindAt);
  const time = hhmm(date);
  if (remindAt <= now) return `Напоминание прошло · ${time}`;

  const today = new Date(now);
  if (sameDay(date, today)) return `Сегодня в ${time}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(date, tomorrow)) return `Завтра в ${time}`;

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month} в ${time}`;
}

/**
 * Куда ведёт уведомление.
 *
 * Адрес приходит от страницы и уходит в письмо и в шторку телефона. Наружу он
 * вести не должен: `//evil.tld` браузер понимает как чужой сайт, а не как путь
 * внутри своего. Поэтому принимается только путь, начинающийся с одной косой
 * черты.
 */
export function sanitizeReminderLink(link: unknown, fallback = "/workspace"): string {
  if (typeof link !== "string" || !link.startsWith("/") || link.startsWith("//")) return fallback;
  if (link.includes("\\") || link.length > 300) return fallback;
  return link;
}

/** Заголовок карточки в уведомлении. Пустой — карточку ещё не назвали. */
export function reminderTitle(title: unknown): string {
  const text = typeof title === "string" ? title.trim() : "";
  if (!text) return "Карточка без названия";
  return text.slice(0, MAX_REMINDER_TITLE);
}
