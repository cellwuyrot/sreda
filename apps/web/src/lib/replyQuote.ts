export interface ReplyDraft { id: string; name: string; content: string; quote?: string | null }

/** Read only a selection fully inside this message's body, not author/toolbar. */
export function selectedReplyQuote(row: HTMLElement | null): string | null {
  const selection = window.getSelection();
  const body = row?.querySelector("[data-message-body]");
  if (!body || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return null;
  return selection.toString().trim() || null;
}
export function validReplyQuote(quote: unknown, source: string): quote is string {
  return typeof quote === "string" && quote.length > 0 && quote.length <= 25000 && (source.includes(quote) || (plainReplySource(quote).length > 0 && plainReplySource(source).includes(plainReplySource(quote))));
}

/** Formatting shown by messageFormat is not part of the selected text. */
function plainReplySource(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1")
    .replace(/^(?:## |>|- |•)/gm, "").replace(/\s+/g, " ").trim();
}
