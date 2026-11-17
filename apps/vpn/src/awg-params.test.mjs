import { describe, expect, it } from "vitest";
import { PARAM_KEYS } from "./awg-params.mjs";
import { parseInterfaceParams } from "./rules.mjs";
describe("AWG 3.1 agent whitelist", () => {
  it("preserves base64 padding, ranges and explicit false without leaking private keys", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const text = `[Interface]\nPrivateKey = secret\nHeaderProtectionKey = ${key}\nContentPaddingAddition = 0-64\nRandomTrailers = false\nDisableCookies = 0\n[Peer]\nHeaderProtectionKey = wrong`;
    expect(parseInterfaceParams(text, PARAM_KEYS)).toEqual({ HeaderProtectionKey: key, ContentPaddingAddition: "0-64", RandomTrailers: "false", DisableCookies: 0 });
  });
});
