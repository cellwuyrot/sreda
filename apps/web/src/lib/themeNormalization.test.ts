import { describe, expect, it } from "vitest";
import { normalizeTheme } from "./themeNormalization";
describe("legacy theme migration", () => {
  it.each([[null, "dark"], ["light", "dark"], ["dark", "dark"], ["mono-lite", "mono"], ["mono", "mono"], ["unknown", "dark"]])("maps %s to %s", (input, expected) => {
    expect(normalizeTheme(input)).toBe(expected);
  });
});
