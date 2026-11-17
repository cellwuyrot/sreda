import { describe, expect, it } from "vitest";
import { findMentionQuery, hasEveryoneMention, parseMentions, resolveMentionIds } from "./mentions";

describe("единый parser mentions", () => {
  it.each([
    ["Привет @ivan", ["ivan"]],
    ["Привет @новый-ник", ["новый-ник"]],
    ["Привет @你好世界朋友", ["你好世界朋友"]],
    ["Привет @everyone_test", ["everyone_test"]],
    ["часть@ivan.com", []],
    ["foo@everyone.com", []],
    ["test@ivan", []],
    ["Привет (@ivan)", ["ivan"]],
    ["@ivan, привет", ["ivan"]],
    ["http://site/@ivan", []],
  ])("%s", (text, expected) => {
    expect(parseMentions(text).map((m) => m.normalized)).toEqual(expected);
  });

  it("не считает @everyone внутри email", () => {
    expect(hasEveryoneMention("foo@everyone.com")).toBe(false);
    expect(hasEveryoneMention("Привет @everyone")).toBe(true);
  });

  it("разрешает ID только реальных участников", () => {
    const members = [{ id: "1", username: "ivan" }, { id: "2", username: "alex" }];
    expect(resolveMentionIds("@ivan @unknown", members)).toEqual(["1"]);
  });

  it("autocomplete использует те же границы", () => {
    expect(findMentionQuery("Привет @iv", 10)).toEqual({ query: "iv", start: 7 });
    expect(findMentionQuery("mail@iv", 7)).toBeNull();
    expect(findMentionQuery("http://x/@iv", 12)).toBeNull();
  });
});