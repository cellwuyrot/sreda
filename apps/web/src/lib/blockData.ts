/**
 * Разбор поля `data` у блоков страницы /about.
 *
 * Зачем это нужно. В базе `AboutBlock.data` — колонка String, в которой
 * лежит JSON. Но за время жизни проекта записи туда попадали тремя разными
 * путями (/api/about-blocks, /api/admin/about-blocks и его [id]-версия), и часть
 * из них сохраняла уже готовую строку через JSON.stringify ещё раз. В итоге в базе
 * встречаются дважды закодированные значения вида "\"{\\\"items\\\":[]}\"".
 *
 * Старый разбор был `JSON.parse(b.data)` с молчаливым `catch { return {} }`:
 *  • дважды закодированное значение давало строку, а не объект;
 *  • любая ошибка тихо превращалась в пустой объект.
 * В обоих случаях компоненты видели `data.items === undefined` и выходили через
 * `if (!data.items?.length) return null` — блоки исчезали со страницы без единой
 * ошибки в консоли. Hero такой защиты не имеет, поэтому он один и оставался виден.
 */

/** Максимум слоёв кодирования, которые разбираем (защита от зацикливания). */
const MAX_DECODE_DEPTH = 5;

/**
 * Приводит любое сохранённое значение к обычному объекту с данными блока.
 *
 * Понимает: объект, JSON-строку, дважды (и более) закодированную строку,
 * пустоту и мусор. Всегда возвращает объект — никогда не бросает исключений.
 */
export function parseBlockData(value: unknown): Record<string, unknown> {
  let current: unknown = value;

  for (let depth = 0; depth < MAX_DECODE_DEPTH; depth += 1) {
    if (current === null || current === undefined) return {};

    if (typeof current === "string") {
      const trimmed = current.trim();
      if (trimmed === "") return {};
      try {
        current = JSON.parse(trimmed);
        continue;
      } catch {
        return {};
      }
    }

    if (Array.isArray(current)) return {};

    if (typeof current === "object") return current as Record<string, unknown>;

    // число / boolean / что-то ещё — осмысленных данных нет
    return {};
  }

  return {};
}

/**
 * Готовит значение к записи в колонку String.
 *
 * Сначала приводит вход к объекту, и только потом кодирует. Благодаря этому
 * клиент, приславший уже готовую строку, больше не создаёт второй слой
 * кодирования — именно это ломало отображение блоков.
 */
export function serializeBlockData(value: unknown): string {
  return JSON.stringify(parseBlockData(value));
}
