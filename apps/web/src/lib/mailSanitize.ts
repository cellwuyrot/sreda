import sanitizeHtml from "sanitize-html";

export const EMAIL_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "hr", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "del", "a", "ul", "ol", "li", "blockquote", "code", "pre", "span", "div", "img", "table", "thead", "tbody", "tr", "td", "th"],
  allowedAttributes: { "*": ["style", "align"], a: ["href", "target", "rel"], img: ["src", "alt", "width", "height", "style"], table: ["role", "width", "cellpadding", "cellspacing", "border"] },
  allowedSchemes: ["http", "https", "mailto", "cid", "data"],
  transformTags: { a: (tag, attrs) => ({ tagName: "a", attribs: { ...attrs, target: "_blank", rel: "noopener noreferrer" } }) },
};

export const SIGNATURE_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  ...EMAIL_SANITIZE_OPTIONS,
};

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(String(html || ""), EMAIL_SANITIZE_OPTIONS);
}
export function sanitizeSignatureHtml(html: string): string {
  return sanitizeHtml(String(html || ""), SIGNATURE_SANITIZE_OPTIONS);
}
