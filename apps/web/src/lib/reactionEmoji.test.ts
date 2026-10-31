import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TRIOZ_EMOJI_PACK, findReactionEmoji, matchesEmojiQuery, parseRecentEmoji, prependRecentEmoji, splitEmojiText, MAX_RECENT_EMOJI } from "./reactionEmoji";

describe("reaction artwork compatibility", () => {
  it("preserves all 25 stored Unicode values and file IDs", () => {
    expect(TRIOZ_EMOJI_PACK.map(item => [item.emoji, item.id])).toEqual([
      ["❤️","heart"],["✅","check"],["✨","sparkles"],["🔥","fire"],["😭","cry"],["😂","joy"],["😊","smile"],["💀","skull"],["⭐","star"],["🫶","heart-hands"],["👍","like"],["👀","eyes"],["🙏","pray"],["🎉","party"],["😍","love"],["🥹","pleading"],["🤣","laugh"],["😎","cool"],["🤔","think"],["😢","sad"],["😡","angry"],["👏","clap"],["🚀","rocket"],["💯","hundred"],["😮","wow"],
    ]);
  });
  it("provides safe self-contained gradient SVGs for the entire pack", () => {
    for (const item of TRIOZ_EMOJI_PACK) {
      const svg = readFileSync(fileURLToPath(new URL(`../../public/emojis/trioz/${item.id}.svg`, import.meta.url)), "utf8");
      expect(svg).toContain('viewBox="0 0 256 256"');
      expect(svg).toMatch(/Gradient/);
      expect(svg).not.toMatch(/<script|<foreignObject|onload=|onerror=|href=|<image/i);
      expect(svg.length).toBeLessThan(10000);
    }
  });
  it("recognizes heart variation selector without rewriting the input", () => { expect(findReactionEmoji("❤")?.id).toBe("heart"); expect(findReactionEmoji("❤️")?.id).toBe("heart"); });
  it("does not strip skin tones or composite sequences", () => { expect(findReactionEmoji("👍🏽")).toBeUndefined(); expect(findReactionEmoji("❤️‍🔥")).toBeUndefined(); });
  it("keeps unknown Unicode and custom names outside the builtin mapping", () => { expect(findReactionEmoji("🦊")).toBeUndefined(); expect(findReactionEmoji(":dance:")).toBeUndefined(); });
  it.each(["СЕРДЦЕ", "love", "heart", "❤"])("finds heart using %s", query => expect(TRIOZ_EMOJI_PACK.filter(item => matchesEmojiQuery(item, query)).some(item => item.id === "heart")).toBe(true));
  it("finds Russian е/ё and partial names", () => expect(matchesEmojiQuery(TRIOZ_EMOJI_PACK.find(item => item.id === "cry")!, "слёзы")).toBe(true));
  it("does not invent matches for an unknown query", () => expect(TRIOZ_EMOJI_PACK.filter(item => matchesEmojiQuery(item, "zz-not-an-emoji"))).toEqual([]));
  it.each(["Привет ❤️ 😊!", "Семья 👨‍👩‍👧‍👦", "Огонь ❤️‍🔥", "👍🏽 👍🏻", "Флаг 🇷🇺", "1️⃣", "❤︎"])("preserves complete text %s", text => expect(splitEmojiText(text).join("")).toBe(text));
  it("does not split a composite heart or toned thumb into replaceable pieces", () => { expect(splitEmojiText("❤️‍🔥")).toContain("❤️‍🔥"); expect(splitEmojiText("👍🏽")).toContain("👍🏽"); });
});

describe("local recent emoji data", () => {
  it.each([null, "broken", "{}", "null", '"text"'])("ignores malformed history %s", raw => expect(parseRecentEmoji(raw)).toEqual([]));
  it("ignores oversized storage", () => expect(parseRecentEmoji(" ".repeat(17000))).toEqual([]));
  it("deduplicates display aliases and discards unknown data", () => expect(parseRecentEmoji(JSON.stringify([{ emoji: "❤" },{ emoji: "❤️" },{ emoji: "unknown" },{ emoji: 1 }]))).toEqual([{ emoji: "❤️" }]));
  it("scopes custom emoji by ID without persisting image URLs", () => expect(parseRecentEmoji(JSON.stringify([{ emoji: ":dance:", customId: "group-emoji-1", url: "https://example.invalid/private" }]))).toEqual([{ emoji: ":dance:", customId: "group-emoji-1" }]));
  it("rejects malformed custom names and identifiers", () => expect(parseRecentEmoji(JSON.stringify([{ emoji: ":<img>:", customId: "x" },{ emoji: ":ok:", customId: "" }]))).toEqual([]));
  it("caps and reorders recents", () => {
    const recent = parseRecentEmoji(JSON.stringify(TRIOZ_EMOJI_PACK.map(item => ({ emoji: item.emoji }))));
    expect(recent).toHaveLength(MAX_RECENT_EMOJI);
    const next = prependRecentEmoji(recent, { emoji: recent[5].emoji });
    expect(next).toHaveLength(MAX_RECENT_EMOJI); expect(next[0]).toEqual(recent[5]);
    expect(next.filter(item => item.emoji === recent[5].emoji)).toHaveLength(1);
  });
});
