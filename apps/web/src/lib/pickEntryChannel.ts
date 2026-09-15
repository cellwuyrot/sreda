import { parseGroupTheme } from "@/lib/groupTheme";

export interface EntryChannel { id: string; name?: string; type?: string; }

export function isTextChannel(c: EntryChannel): boolean {
  return !c.type || c.type === "TEXT" || c.type === "text";
}

// Возвращает id канала, который должен открыться при входе в сообщество.
export function pickEntryChannel(channels: EntryChannel[], themeOrRaw: any): string | null {
  const text = (channels || []).filter(isTextChannel);
  if (text.length === 0) return null;
  const theme = typeof themeOrRaw === "string" ? parseGroupTheme(themeOrRaw) : (themeOrRaw || {});
  const desired = theme && theme.defaultChannelId;
  if (desired && text.some((c) => c.id === desired)) return desired;
  return text[0].id;
}
export default pickEntryChannel;
