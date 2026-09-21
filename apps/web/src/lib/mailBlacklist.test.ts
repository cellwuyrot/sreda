import { describe, expect, it } from "vitest";
import { isBlacklistedSender, normalizeSenderAddress } from "./mailBlacklist";

const entries = [
  { id: "1", address: "bad@example.com", note: "", addedAt: "" },
  { id: "2", address: "@blocked.test", note: "", addedAt: "" },
];

describe("mail blacklist matching", () => {
  it("extracts a mailbox from a display-name address", () => {
    expect(normalizeSenderAddress("Sender <BAD@Example.com>")).toBe("bad@example.com");
  });

  it("matches an exact mailbox and an exact domain", () => {
    expect(isBlacklistedSender("Bad <bad@example.com>", entries)).toBe(true);
    expect(isBlacklistedSender("user@blocked.test", entries)).toBe(true);
  });

  it("never blocks by substring", () => {
    expect(isBlacklistedSender("notbad@example.com", entries)).toBe(false);
    expect(isBlacklistedSender("user@notblocked.test", entries)).toBe(false);
  });
});