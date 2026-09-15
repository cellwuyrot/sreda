import type { Channel } from "@/components/connect/groupTypes";
import { parseGroupTheme } from "@/lib/groupTheme";

export interface EntryChannelTheme { defaultChannelId?: string; }

export function isTextChannel(c: Channel): boolean {
  return !c.type || c.type === "TEXT" || c.type === "text";
}

export function pickEntryChannel(channels: Channel[], themeOrRaw: unknown): Channel | null {
  const text = (channels || []).filter(isTextChannel);
  if (text.length === 0) return null;
  const theme: EntryChannelTheme = typeof themeOrRaw === "string"
    ? parseGroupTheme(themeOrRaw)
    : (themeOrRaw && typeof themeOrRaw === "object" ? themeOrRaw as EntryChannelTheme : {});
  const desired = theme.defaultChannelId;
  if (desired) {
    const preferred = text.find((c) => c.id === desired);
    if (preferred) return preferred;
  }
  return text[0] ?? null;
}

export default pickEntryChannel;
