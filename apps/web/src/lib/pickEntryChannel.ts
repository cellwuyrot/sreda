/** GROUP-SKIN: какой текстовый канал открывать при входе в сообщество. */
import { parseGroupTheme, type GroupTheme } from "@/lib/groupTheme";

export interface EntryChannelLike { id: string; type?: string; parentId?: string | null; }

export function isTextChannel(c: EntryChannelLike): boolean {
  return !c.type || c.type === "TEXT" || c.type === "text";
}

export function pickEntryChannel<T extends EntryChannelLike>(
  channels: T[], theme: GroupTheme | string | null | undefined,
): T | undefined {
  const list = channels || [];
  const t: GroupTheme | null =
    theme && typeof theme === "object" ? (theme as GroupTheme) : parseGroupTheme(theme as string | null | undefined);
  const wanted = t?.defaultChannelId;
  if (wanted) {
    const chosen = list.find((c) => c.id === wanted && isTextChannel(c));
    if (chosen) return chosen;
  }
  return list.find((c) => isTextChannel(c) && !c.parentId) ?? list.find((c) => isTextChannel(c));
}
