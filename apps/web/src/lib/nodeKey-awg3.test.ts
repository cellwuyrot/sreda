import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/vpn", () => ({ isValidWireGuardKey: (key: unknown) => typeof key === "string" && /^[A-Za-z0-9+/]{43}=$/.test(key) }));
import { buildNodeKey, parseNodeKey } from "./nodeKey";
const key = Buffer.alloc(32, 7).toString("base64");
const node = { host: "185.109.21.157", port: 51820, publicKey: key, token: "x".repeat(40), subnet: "10.8.0.0/24", awg: { Jc: 4, Jmin: 40, Jmax: 200, S1: 12, S2: 12, S3: 12, S4: 12, H1: 1, H2: 2, H3: 3, H4: 4, HeaderProtectionKey: key, ContentPaddingAddition: "0-64", RandomTrailers: "1" } };
describe("AWG 3.1 node key", () => {
  it("does not drop 3.1 options on node import", () => {
    const parsed = parseNodeKey(buildNodeKey(node));
    expect("node" in parsed && parsed.node.awg).toMatchObject(node.awg);
  });
  it("refuses a broken security option rather than importing a 2.x node", () => {
    const parsed = parseNodeKey(buildNodeKey({ ...node, awg: { ...node.awg, HeaderProtectionKey: "invalid-secret" } }));
    expect("error" in parsed).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("invalid-secret");
  });
});
