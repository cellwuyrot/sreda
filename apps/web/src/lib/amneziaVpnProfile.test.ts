import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildAmneziaVpnProfile } from "@/lib/amneziaVpnProfile";

function decode(uri: string): Record<string, unknown> {
  const encoded = uri
    .slice("vpn://".length)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const packed = Buffer.from(
    encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="),
    "base64",
  );
  const expectedLength = packed.readUInt32BE(0);
  const json = inflateSync(packed.subarray(4));
  expect(json.byteLength).toBe(expectedLength);
  return JSON.parse(json.toString("utf8")) as Record<string, unknown>;
}

const PRIVATE_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const SERVER_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
const CONFIG = `[Interface]
Jc = 4
Jmin = 50
Jmax = 1000
S1 = 10
H1 = 123456789
PrivateKey = ${PRIVATE_KEY}
Address = 10.8.0.7/32
DNS = 1.1.1.1, 8.8.8.8
MTU = 1280

[Peer]
PublicKey = ${SERVER_KEY}
Endpoint = vpn.example.com:51820
AllowedIPs = 10.20.0.0/16, 203.0.113.10/32
PersistentKeepalive = 25
`;

describe("buildAmneziaVpnProfile", () => {
  it("создаёт Qt-compatible vpn:// с официальной структурой AmneziaWG", async () => {
    const profile = await buildAmneziaVpnProfile(CONFIG);
    expect(profile.uri).toMatch(/^vpn:\/\/[A-Za-z0-9_-]+$/);

    const root = decode(profile.uri) as {
      format_version: number;
      defaultContainer: string;
      hostName: string;
      dns1: string;
      dns2: string;
      containers: Array<{
        container: string;
        awg: { last_config: string; isThirdPartyConfig: boolean };
      }>;
    };
    expect(root.format_version).toBe(1);
    expect(root.defaultContainer).toBe("amnezia-awg");
    expect(root.hostName).toBe("vpn.example.com");
    expect([root.dns1, root.dns2]).toEqual(["1.1.1.1", "8.8.8.8"]);
    expect(root.containers[0].container).toBe("amnezia-awg");
    expect(root.containers[0].awg.isThirdPartyConfig).toBe(true);

    const last = JSON.parse(root.containers[0].awg.last_config);
    expect(last.config).toBe(CONFIG);
    expect(last.client_priv_key).toBe(PRIVATE_KEY);
    expect(last.server_pub_key).toBe(SERVER_KEY);
    expect(last.allowed_ips).toEqual(["10.20.0.0/16", "203.0.113.10/32"]);
    expect(last.mtu).toBe("1280");
    expect(last.Jc).toBe("4");
    expect(last.H1).toBe("123456789");
  });

  it("не добавляет клиентские лимиты или отдельный peer", async () => {
    const root = decode((await buildAmneziaVpnProfile(CONFIG)).uri);
    const serialized = JSON.stringify(root);
    expect(serialized).not.toMatch(/traffic|limit|throttle|block|VpnPeer/i);
    expect(serialized.match(/client_priv_key/g)).toHaveLength(1);
  });

  it("отклоняет готовый профиль без корректного endpoint", async () => {
    await expect(
      buildAmneziaVpnProfile(CONFIG.replace("vpn.example.com:51820", "broken")),
    ).rejects.toThrow(/endpoint/);
  });
});
