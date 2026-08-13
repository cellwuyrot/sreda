import sanitizeHtml from "sanitize-html";

/**
 * Sanitizes plain-text user input (messages, comments).
 * Strips ALL HTML tags — used for chat messages.
 */
/**
 * Таблица для обратного раскрытия сущностей ЗА ОДИН проход.
 *
 * FIX-SEC: раньше сущности раскрывались цепочкой .replace() по очереди, и
 * последний шаг (`&amp;` -> `&`) делал из уже безопасного текста новый:
 * `&amp;lt;script&amp;gt;` превращался в `<script>`. Одна регулярка с таблицей
 * раскрывает каждую сущность ровно один раз, и текст, который человек написал
 * как «&amp;lt;», таким и остаётся.
 */
const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&amp;": "&",
};

/**
 * FIX-SEC: невидимые и управляющие символы.
 *
 * Управляющие байты ломают журналы и разбор, а метки направления письма
 * (U+202A…U+202E, U+2066…U+2069) позволяют показать имя, ссылку или название
 * файла задом наперёд — так подделывают расширение вложения. Невидимые
 * пробелы к тому же обходят поиск по словам. Перевод строки и табуляция
 * сохраняются: они часть текста.
 */
function stripInvisible(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
}

export function sanitizeText(input: string): string {
  const stripped = sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
  });
  // sanitize-html экранирует спецсимволы в HTML-сущности ("=>" -> "=&gt;").
  // Сообщения рендерятся как обычный текст (React сам экранирует вывод),
  // поэтому возвращаем символы обратно — отправленный текст выглядит как в поле ввода.
  const decoded = stripped.replace(/&(?:lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity] ?? entity);
  return stripInvisible(decoded).trim();
}

/**
 * Sanitizes rich-text content (articles) allowing safe formatting tags.
 * Strips dangerous tags like <script>, <iframe>, event handlers.
 */
export function sanitizeRichText(input: string): string {
  return stripInvisible(sanitizeHtml(input, {
    allowedTags: [
      "b", "i", "em", "strong", "u", "s",
      "p", "br", "ul", "ol", "li",
      "h1", "h2", "h3", "h4",
      "blockquote", "code", "pre", "a",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  }).trim());
}
