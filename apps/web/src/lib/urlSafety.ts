import { BlockList, isIP } from "node:net";

const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [base, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked4.addSubnet(base, prefix, "ipv4");
for (const [base, prefix] of [
  ["::", 96], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["64:ff9b:1::", 48], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked6.addSubnet(base, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked4.check(address, "ipv4") : family === 6 && !blocked6.check(address, "ipv6");
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || [".localhost", ".internal", ".local"].some(s => host.endsWith(s))) return true;
  return isIP(host) !== 0 && !isPublicAddress(host);
}

/** Syntax checks are only the first layer. Network requests MUST also use
 * externalFetch, which validates DNS and pins the socket to that address. */
export function safeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || isBlockedHost(url.hostname)) return null;
    return url;
  } catch { return null; }
}
