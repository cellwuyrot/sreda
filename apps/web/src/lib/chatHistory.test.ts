import { describe, expect, it } from "vitest";
import { mergeHistory } from "./chatHistory";
import { validReplyQuote } from "./replyQuote";

describe("community history", () => {
  it("deduplicates concurrent pages and keeps incoming edits", () => {
    const a = { id: "a", createdAt: "2026-01-01T00:00:00Z", content: "old" };
    expect(mergeHistory([a], [{ ...a, content: "updated" }])).toEqual([{ ...a, content: "updated" }]);
  });
  it("orders timestamp ties by ID just like the API", () => {
    const createdAt = "2026-01-01T00:00:00Z";
    expect(mergeHistory([{ id: "z", createdAt }], [{ id: "a", createdAt }]).map(x => x.id)).toEqual(["a", "z"]);
  });
  it("joins older and newer pages in chronological order", () => {
    expect(mergeHistory([{ id: "b", createdAt: "2026-02-01" }], [{ id: "c", createdAt: "2026-03-01" }, { id: "a", createdAt: "2026-01-01" }]).map(x => x.id)).toEqual(["a", "b", "c"]);
  });
});
describe("reply quote validation", () => {
  it("accepts a complete selected fragment with newlines", () => expect(validReplyQuote("long\nfragment", "a long\nfragment b")).toBe(true));
  it("accepts selection across inline formatting", () => expect(validReplyQuote("before bold after", "before **bold** after")).toBe(true));
  it("supports the full allowed message length", () => expect(validReplyQuote("x".repeat(25000), "x".repeat(25000))).toBe(true));
  it("rejects invented text, non-strings and empty fragments", () => {
    for (const quote of ["invented", 10, {}, "", "**"]) expect(validReplyQuote(quote, "original")).toBe(false);
  });
  it("rejects oversized fragments", () => expect(validReplyQuote("x".repeat(25001), "x".repeat(25001))).toBe(false));
});
