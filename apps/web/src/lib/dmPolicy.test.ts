import { describe, it, expect } from "vitest";
import { dmCapabilities, dmPageLimit, secureDmError, validDmCiphertext } from "./dmPolicy";
const cipher = `e2ee:v2:${"ab".repeat(12)}:${"cd".repeat(20)}`;
describe("DM fail-closed policy", () => {
  it.each(["text", "e2ee:plain", "e2ee:v3:aa:bb", `e2ee:v2:${"a".repeat(24)}:abc`, ""])('rejects invalid secure envelope %s', value => expect(validDmCiphertext(value)).toBe(false));
  it("accepts current and legacy complete envelopes", () => { expect(validDmCiphertext(cipher)).toBe(true); expect(validDmCiphertext(cipher.replace("v2:", ""))).toBe(true); });
  it("blocks attachments and open quote in secure mode", () => { expect(secureDmError("SECURE", cipher, [{ url: "/uploads/x" }])).toBeTruthy(); expect(secureDmError("SECURE", cipher, [], "quote")).toBeTruthy(); expect(secureDmError("SECURE", cipher, [])).toBeNull(); });
  it("does not change normal/business text policy", () => { expect(secureDmError("PERSONAL", "hi")).toBeNull(); expect(secureDmError("BUSINESS", "hi")).toBeNull(); });
  it("does not expose unsupported secure or thread features", () => { expect(dmCapabilities("SECURE")).toEqual({ search: false, reactions: false, threads: false, attachments: false, export: false, quote: false }); expect(dmCapabilities("PERSONAL").reactions).toBe(true); expect(dmCapabilities("BUSINESS").search).toBe(false); });
  it.each([[null,50],["garbage",50],["-1",50],["0",50],["1000",100],["5",5],["2.5",50]])("clamps page limit %s", (value,expected) => expect(dmPageLimit(value as string | null)).toBe(expected));
});
