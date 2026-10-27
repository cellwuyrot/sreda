import { expect, it } from "vitest";
import { trustedAppFrame } from "./ipcTrust";
it("trusts only the configured origin in the main frame", () => {
  expect(trustedAppFrame("https://trioz.ru/connect", true, "https://trioz.ru")).toBe(true);
  expect(trustedAppFrame("https://trioz.ru/connect", false, "https://trioz.ru")).toBe(false);
  expect(trustedAppFrame("https://trioz.ru.attacker.example", true, "https://trioz.ru")).toBe(false);
  expect(trustedAppFrame("file:///tmp/evil.html", true, "https://trioz.ru")).toBe(false);
  expect(trustedAppFrame(undefined, true, "https://trioz.ru")).toBe(false);
});
