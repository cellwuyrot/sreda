import { describe, expect, it } from "vitest";
import { awgExtraUapi, AWG3_UAPI } from "./awg3Uapi";
import { parseWgConfig as parseService } from "./vpnProfile";
import { parseWgConfig, uapiSetRequest } from "./vpnEmbedded";
const hpk = Buffer.alloc(32, 7).toString("base64");
const conf = `[Interface]\nPrivateKey = ${hpk}\nAddress = 10.8.0.2/32\nHeaderProtectionKey = ${hpk}\nContentPaddingAddition = 0-64\nRandomTrailers = 0\n[Peer]\nPublicKey = ${hpk}\nEndpoint = 170.168.18.20:51820\nAllowedIPs = 0.0.0.0/0`;
describe("AWG 3.1 desktop pipeline", () => {
  it("both service and helper parsers retain options", () => {
    for (const parse of [parseService, parseWgConfig]) {
      expect(parse(conf).extra).toMatchObject({ headerprotectionkey: hpk, contentpaddingaddition: "0-64", randomtrailers: "0" });
      expect(parse(conf).peers[0].endpoint).toBe("170.168.18.20:51820");
    }
  });
  it("translates all new names and converts HPK to hex", () => {
    expect(awgExtraUapi("headerprotectionkey", hpk)).toBe(`header_protection_key=${"07".repeat(32)}`);
    for (const [key, wire] of Object.entries(AWG3_UAPI)) if (key !== "headerprotectionkey") expect(awgExtraUapi(key, "0")).toBe(`${wire}=0`);
    const request = uapiSetRequest(parseWgConfig(conf), true, "linux");
    expect(request).toContain(`header_protection_key=${"07".repeat(32)}\n`);
    expect(request).toContain("content_padding_addition=0-64\n");
    expect(request.indexOf("header_protection_key=")).toBeLessThan(request.indexOf("public_key="));
  });
  it("rejects malformed HPK and multiline UAPI injection", () => {
    expect(() => awgExtraUapi("headerprotectionkey", "bad")).toThrow();
    expect(() => awgExtraUapi("randomtrailers", "0\nreplace_peers=true")).toThrow();
  });
});
