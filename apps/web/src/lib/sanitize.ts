import sanitizeHtml from "sanitize-html";

/**
 * Sanitizes plain-text user input (messages, comments).
 * Strips ALL HTML tags — used for chat messages.
 */
export function sanitizeText(input: string): string {
  const stripped = sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
  // sanitize-html экранирует спецсимволы в HTML-сущности ("=>" -> "=&gt;").
  // Сообщения рендерятся как обычный текст (React сам экранирует вывод),
  // поэтому возвращаем символы обратно — отправленный текст выглядит как в поле ввода.
  return stripped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Sanitizes rich-text content (articles) allowing safe formatting tags.
 * Strips dangerous tags like <script>, <iframe>, event handlers.
 */
export function sanitizeRichText(input: string): string {
  return sanitizeHtml(input, {
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
  }).trim();
}
