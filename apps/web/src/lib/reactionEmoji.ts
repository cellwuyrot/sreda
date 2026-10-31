export const TRIOZ_EMOJI_PACK = [
  { emoji: "❤️", id: "heart", label: "Любовь" },
  { emoji: "✅", id: "check", label: "Готово" },
  { emoji: "✨", id: "sparkles", label: "Восхищение" },
  { emoji: "🔥", id: "fire", label: "Огонь" },
  { emoji: "😭", id: "cry", label: "Сильная грусть" },
  { emoji: "😂", id: "joy", label: "Радость" },
  { emoji: "😊", id: "smile", label: "Улыбка" },
  { emoji: "💀", id: "skull", label: "Умер со смеху" },
  { emoji: "⭐", id: "star", label: "Звезда" },
  { emoji: "🫶", id: "heart-hands", label: "Поддержка" },
  { emoji: "👍", id: "like", label: "Нравится" },
  { emoji: "👀", id: "eyes", label: "Смотрю" },
  { emoji: "🙏", id: "pray", label: "Спасибо" },
  { emoji: "🎉", id: "party", label: "Праздник" },
  { emoji: "😍", id: "love", label: "Влюблённость" },
  { emoji: "🥹", id: "pleading", label: "Тронут" },
  { emoji: "🤣", id: "laugh", label: "Очень смешно" },
  { emoji: "😎", id: "cool", label: "Круто" },
  { emoji: "🤔", id: "think", label: "Думаю" },
  { emoji: "😢", id: "sad", label: "Грусть" },
  { emoji: "😡", id: "angry", label: "Злость" },
  { emoji: "👏", id: "clap", label: "Аплодисменты" },
  { emoji: "🚀", id: "rocket", label: "Запуск" },
  { emoji: "💯", id: "hundred", label: "Сто процентов" },
  { emoji: "😮", id: "wow", label: "Удивление" },
] as const;

// Display aliases only. Never rewrite strings already stored as reactions.
export const REACTION_EMOJI_ASSET_VERSION = "2";
export const RECENT_EMOJI_KEY = "trioz.emoji.recent.v2";
export const RECENT_EMOJI_EVENT = "trioz-emoji-recents";
export const MAX_RECENT_EMOJI = 12;
const stripPresentation = (value: string) => value.replace(/\uFE0F/g, "");
const byEmoji = new Map(TRIOZ_EMOJI_PACK.map(item => [stripPresentation(item.emoji), item]));
export function findReactionEmoji(value: string) { return byEmoji.get(stripPresentation(value)); }
const SEARCH_WORDS: Record<string, string> = {
  heart: "сердце люблю love heart", check: "да ок выполнено done ok check", sparkles: "искры блеск wow sparkles",
  fire: "круто жар fire hot", cry: "слезы плачу cry tears", joy: "смех смешно lol joy laugh", smile: "привет рад happy smile",
  skull: "череп умер skull dead", star: "звезда star", "heart-hands": "руки сердце поддержка support hands",
  like: "лайк палец да like thumb yes", eyes: "глаза смотрю вижу eyes look", pray: "спасибо прошу thanks pray",
  party: "ура праздник поздравляю party celebrate", love: "сердца люблю love", pleading: "прошу мило тронут please",
  laugh: "смех хаха lol laugh", cool: "очки круто cool", think: "думаю вопрос think", sad: "печаль грусть sad",
  angry: "злюсь гнев angry", clap: "браво хлопки applause clap", rocket: "ракета запуск rocket launch",
  hundred: "100 сто процентов hundred", wow: "удивление wow surprise",
};
export function normalizeEmojiQuery(value: string) { return stripPresentation(value).normalize("NFKC").toLowerCase().replace(/ё/g, "е").trim(); }
export function matchesEmojiQuery(value: { emoji: string; label: string; id: string }, query: string) {
  const haystack = normalizeEmojiQuery(`${value.emoji} ${value.label} ${value.id} ${SEARCH_WORDS[value.id] || ""}`);
  return normalizeEmojiQuery(query).split(/\s+/).every(part => haystack.includes(part));
}
export interface RecentEmoji { emoji: string; customId?: string }
export function parseRecentEmoji(raw: string | null): RecentEmoji[] {
  try {
    if (!raw || raw.length > 16000) return [];
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    const result: RecentEmoji[] = [], seen = new Set<string>();
    for (const row of rows.slice(0, 100)) {
      if (!row || typeof row !== "object" || typeof row.emoji !== "string") continue;
      const builtin = findReactionEmoji(row.emoji);
      const custom = typeof row.customId === "string" && row.customId.length > 0 && row.customId.length <= 128 && /^:[a-z0-9_]{2,32}:$/.test(row.emoji);
      if (!builtin && !custom) continue;
      const item: RecentEmoji = builtin ? { emoji: builtin.emoji } : { emoji: row.emoji, customId: row.customId };
      const key = `${item.customId || ""}/${item.emoji}`;
      if (!seen.has(key)) { result.push(item); seen.add(key); }
      if (result.length === MAX_RECENT_EMOJI) break;
    }
    return result;
  } catch { return []; }
}
export function prependRecentEmoji(previous: RecentEmoji[], value: RecentEmoji) {
  return parseRecentEmoji(JSON.stringify([value, ...previous]));
}
// Match complete pictographic sequences, not fragments of ZWJ or skin-tone emoji.
const EMOJI_SEQUENCES = /(\p{Extended_Pictographic}(?:[\uFE0E\uFE0F]|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:[\uFE0E\uFE0F]|\p{Emoji_Modifier})*)*)/gu;
export function splitEmojiText(text: string) { return text.split(EMOJI_SEQUENCES); }
