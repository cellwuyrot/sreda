import { describe, it, expect } from "vitest";
import {
  safeBrandColor,
  linkAccent,
  previewIdentity,
  firstLink,
} from "./linkPreviewPolicy";
describe("external branding without foreign CSS", () => {
  it.each([
    "red",
    "url(https://evil.invalid)",
    "#abc",
    "#fff;display:none",
    "var(--secret)",
    null,
    42,
  ])("rejects unsafe color %s", (value) =>
    expect(safeBrandColor(value)).toBeNull(),
  );
  it("accepts only a six-digit color", () =>
    expect(safeBrandColor(" #01aBcF ")).toBe("#01aBcF"));
  it("uses site branding where available", () =>
    expect(linkAccent("https://external.example/article", "#ff6600")).toBe(
      "#ff6600",
    ));
  it("derives stable per-host fallback, independent of article", () =>
    expect(linkAccent("https://example.org/a")).toBe(
      linkAccent("https://example.org/b"),
    ));
  it("distinguishes external domains", () =>
    expect(linkAccent("https://example.org")).not.toBe(
      linkAccent("https://different.example"),
    ));
  it.each([
    ["channel", "abc"],
    ["dm", "cm123_456"],
  ])("accepts scoped identity", (scope, id) =>
    expect(previewIdentity(scope, id)).toBe(true),
  );
  it.each([
    ["user", "abc"],
    ["dm", "../../secret"],
    ["channel", ""],
  ])("rejects malformed identity", (scope, id) =>
    expect(previewIdentity(scope, id)).toBe(false),
  );
  it("extracts external URL with query", () =>
    expect(firstLink("https://external.example/article?a=1&b=2")).toBe(
      "https://external.example/article?a=1&b=2",
    ));
});
