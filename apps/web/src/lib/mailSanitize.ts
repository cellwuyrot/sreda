/** PROJECT-MAIL: безопасная очистка HTML писем и подписей. */
import sanitizeHtml from "sanitize-html";

const COMMON_ATTR: Record<string, string[]> = {
  "*": ["style", "align", "width", "height", "dir"],
  a: ["href", "target", "rel", "style"],
  img: ["src", "alt", "width", "height", "style"],
  table: ["role", "width", "cellpadding", "cellspacing", "style", "align", "border"],
  td: ["style", "align", "valign", "width", "colspan", "rowspan"],
  th: ["style", "align", "valign", "width", "colspan", "rowspan"],
};

export const EMAIL_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "html", "head", "body", "meta", "title", "p", "br", "hr", "div", "span",
    "strong", "b", "em", "i", "u", "s", "del", "a", "ul", "ol", "li",
    "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "img",
    "table", "thead", "tbody", "tr", "td", "th",
  ],
  allowedAttributes: COMMON_ATTR,
  allowedSchemes: ["http", "https", "mailto", "cid", "data"],
  allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: "noopener noreferrer", target: attribs.target || "_blank" } }),
  },
};

export const SIGNATURE_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "span", "strong", "b", "em", "i", "u", "a", "img", "div", "small"],
  allowedAttributes: { "*": ["style"], a: ["href", "target", "rel", "style"], img: ["src", "alt", "width", "height", "style"] },
  allowedSchemes: ["http", "https", "mailto", "cid", "data"],
};

export function sanitizeEmailHtml(html: string): string { return sanitizeHtml(html || "", EMAIL_SANITIZE_OPTIONS); }
export function sanitizeSignatureHtml(html: string): string { return sanitizeHtml(html || "", SIGNATURE_SANITIZE_OPTIONS); }
