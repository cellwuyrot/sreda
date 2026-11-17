import { describe, expect, it } from "vitest";
import { normalizeAwg3, AWG3_KEYS } from "./awg3";
import { awgProblem } from "./awgParams";
const key = Buffer.alloc(32, 7).toString("base64");
const base = { Jc: 4, Jmin: 40, Jmax: 200, S1: 12, S2: 12, S3: 12, S4: 12, H1: 1, H2: 2, H3: 3, H4: 4 };
describe("AWG 3.x validation", () => {
  it("does not invent settings for a legacy node", () => expect(normalizeAwg3({})).toEqual({}));
  it("accepts and preserves every 3.x option", () => {
    const source = { ...base, HeaderProtectionKey: key, ContentPaddingAddition: "0-64", RekeyAfterTime: "90-120", RekeyTimeout: 5, RejectAfterTime: 180, KeepaliveTimeout: 10, MaxHandshakeAttempts: 20, RandomTrailers: "true", DisableCookies: "false" };
    const out = normalizeAwg3(source);
    expect(Object.keys(out)).toHaveLength(AWG3_KEYS.length);
    expect(out).toMatchObject({ HeaderProtectionKey: key, RandomTrailers: "1", DisableCookies: "0", RekeyTimeout: "5", ContentPaddingAddition: "0-64" });
    expect(awgProblem(source)).toBe("");
  });
  it.each(["65536", "80-20", "-1", "1-65536", "1\nPrivateKey=bad", "NaN", "", "true"])("rejects bad range %s", value => {
    expect(() => normalizeAwg3({ RekeyTimeout: value })).toThrow(/RekeyTimeout/);
  });
  it.each(["true", "false", "0", "1", 0, 1, true, false])("accepts explicit toggle %s", value => {
    expect(["0", "1"]).toContain(normalizeAwg3({ RandomTrailers: value }).RandomTrailers);
  });
  it.each(["yes", "2", "", null, {}, []])("rejects invalid toggle %s", value => {
    expect(() => normalizeAwg3({ RandomTrailers: value })).toThrow(/RandomTrailers/);
  });
  it("never echoes a malformed header key in errors", () => {
    expect(() => normalizeAwg3({ HeaderProtectionKey: "secret-invalid" })).toThrow("Некорректный HeaderProtectionKey");
  });
  it("requires all four nonce prefixes with HPK", () => {
    expect(() => normalizeAwg3({ ...base, S3: 11, HeaderProtectionKey: key })).toThrow(/S3/);
  });
  it("does not confuse a zero key with enabled header protection", () => {
    expect(normalizeAwg3({ HeaderProtectionKey: Buffer.alloc(32).toString("base64") })).toHaveProperty("HeaderProtectionKey");
  });
  it("rejects header range overlaps", () => {
    expect(awgProblem({ ...base, ContentPaddingAddition: "0", H1: "100-200", H2: "150-250" })).toContain("пересекаться");
  });
  it("allows disjoint uint32 header ranges", () => {
    expect(awgProblem({ ...base, ContentPaddingAddition: "0", H1: "100-200", H2: "300-400", H3: "500-600", H4: "4000000000-4294967295" })).toBe("");
  });
});
