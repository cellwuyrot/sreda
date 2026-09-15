/** PROJECT-MAIL: минимальный Markdown→HTML для писем и HTML→текст. */
export function escapeHtml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineMd(s: string): string {
  let t = escapeHtml(s);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  return t;
}

export function markdownToHtml(md: string): string {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let listType: "ul" | "ol" | null = null;
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { closeList(); i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h) { closeList(); const lvl = h[1].length; out.push(`<h${lvl}>${inlineMd(h[2])}</h${lvl}>`); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { closeList(); out.push("<hr />"); i++; continue; }
    if (/^>\s?/.test(trimmed)) { closeList(); out.push(`<blockquote>${inlineMd(trimmed.replace(/^>\s?/, ""))}</blockquote>`); i++; continue; }
    const ul = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (ul) { if (listType !== "ul") { closeList(); listType = "ul"; out.push("<ul>"); } out.push(`<li>${inlineMd(ul[1])}</li>`); i++; continue; }
    const ol = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ol) { if (listType !== "ol") { closeList(); listType = "ol"; out.push("<ol>"); } out.push(`<li>${inlineMd(ol[1])}</li>`); i++; continue; }
    closeList();
    const buf: string[] = [inlineMd(trimmed)];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|[-*+]\s|\d+[.)]\s|-{3,}$)/.test(lines[i].trim())) {
      buf.push(inlineMd(lines[i].trim())); i++;
    }
    out.push(`<p>${buf.join("<br />")}</p>`);
  }
  closeList();
  return out.join("\n");
}

export function htmlToText(html: string): string {
  return (html || "")
    .replace(/<\s*(br|BR)\s*\/?>/g, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|blockquote|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n").trim();
}
