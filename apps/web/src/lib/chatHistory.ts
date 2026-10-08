export interface HistoryMessage { id: string; createdAt: string }

/** One identity per message, stable chronological order including timestamp ties. */
export function mergeHistory<T extends HistoryMessage>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => {
    const time = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

export interface ScrollAnchor { id: string; offset: number }
export function captureMessageAnchor(container: HTMLElement): ScrollAnchor | null {
  const top = container.getBoundingClientRect().top;
  for (const row of container.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > top && rect.top < top + container.clientHeight) {
      return { id: row.dataset.messageId!, offset: rect.top - top };
    }
  }
  return null;
}
export function restoreMessageAnchor(container: HTMLElement, anchor: ScrollAnchor): boolean {
  const row = [...container.querySelectorAll<HTMLElement>("[data-message-id]")]
    .find(node => node.dataset.messageId === anchor.id);
  if (!row) return false;
  const delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset;
  if (Math.abs(delta) > 0.5) container.scrollTop += delta;
  return true;
}
