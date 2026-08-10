/**
 * Отмена и повтор в TZartstation.
 *
 * ── Почему это отдельная вещь, а не «сохраним копию сцены» ──────────────────
 *
 * Прежний растровый редактор хранил в истории целые картинки в PNG: сорок шагов
 * отмены — это сорок снимков холста, десятки мегабайт в памяти вкладки, и
 * каждый шаг назад означал заново раскодировать картинку и перерисовать всё.
 *
 * Здесь шаг истории — это сцена, то есть несколько килобайт описания. Хранить
 * их дёшево, возврат мгновенный, и объекты после отмены остаются объектами.
 *
 * ── Правила, которые легко нарушить и трудно заметить ───────────────────────
 *
 *   • новое действие стирает «вперёд». Иначе после отмены и правки кнопка
 *     «вернуть» вернула бы состояние из другой ветки работы — то, чего человек
 *     никогда не видел;
 *   • одинаковые подряд состояния в историю не попадают. Перетаскивание объекта
 *     на место и обратно, щелчок по уже выбранному цвету — всё это иначе
 *     набивало бы историю пустыми шагами, и «отменить» переставало бы работать
 *     с первого нажатия;
 *   • глубина ограничена. Память вкладки не бесконечна, а дальше нескольких
 *     десятков шагов назад никто не возвращается.
 */

export interface History<T> {
  /** Прошлое, от старого к новому. */
  past: T[];
  present: T;
  /** Будущее, ближайший шаг первым. */
  future: T[];
}

/** Сколько шагов назад помнит редактор. */
export const HISTORY_LIMIT = 60;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Записать новое состояние.
 *
 * `isEqual` позволяет не сравнивать сцены по ссылке: одна и та же сцена,
 * пересобранная при перерисовке, — это не действие человека.
 */
export function commit<T>(
  history: History<T>,
  next: T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): History<T> {
  if (isEqual(history.present, next)) return history;
  const past = [...history.past, history.present];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    future: [],
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return { past: [...history.past, history.present], present: next as T, future: rest };
}

/**
 * Заменить состояние, не записывая шаг.
 *
 * Два случая. Первый: сцену переписал не человек, а приход извне — на общем
 * холсте состояние обновляет другой участник, и это не должно попадать в чужую
 * историю как «моё действие, которое можно отменить». Второй: правка ещё идёт —
 * ползунок прозрачности под пальцем шлёт десятки значений в секунду, и каждое
 * не должно становиться шагом.
 */
export function reset<T>(history: History<T>, present: T): History<T> {
  return { past: history.past, present, future: [] };
}

/**
 * Закрыть длящуюся правку одним шагом.
 *
 * В прошлое уходит состояние ДО начала правки, а настоящее остаётся тем, что
 * человек видит сейчас. Так весь проход ползунка от края до края отменяется
 * одним нажатием, а не сорока.
 */
export function commitFrom<T>(
  history: History<T>,
  base: T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): History<T> {
  if (isEqual(history.present, base)) return history;
  const past = [...history.past, base];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: history.present,
    future: [],
  };
}
