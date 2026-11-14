/** Decrypt one offline-provisioned pilot credential bundle. Never log input or output. */
import { createDecipheriv } from "node:crypto";
import { buildTrustTunnelPilotConfig } from "./trustTunnelClientConfig";

export class PilotBundleError extends Error {
  constructor() { super("Invalid TrustTunnel pilot bundle"); }
}
const allowedChars = /^[A-Za-z0-9_-]+$/;
function fromB64(value: string): Buffer {
  if (!value || !allowedChars.test(value)) throw new PilotBundleError();
  const data = Buffer.from(value, "base64url");
  if (data.toString("base64url") !== value) throw new PilotBundleError();
  return data;
}

/** Select only the authenticated user's entry; never accept a user id from request body. */
export function profileForPilotAccount(accountId: string, keyHex: string, bundle: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId) || !/^[a-f0-9]{64}$/i.test(keyHex) || bundle.length > 65536)
    throw new PilotBundleError();
  const parts = bundle.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new PilotBundleError();
  const iv = fromB64(parts[1]); const encrypted = fromB64(parts[2]); const tag = fromB64(parts[3]);
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length > 48 * 1024) throw new PilotBundleError();
  try {
    const cipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
    cipher.setAAD(Buffer.from("trioz-trusttunnel-pilot-v1"));
    cipher.setAuthTag(tag);
    const plain = Buffer.concat([cipher.update(encrypted), cipher.final()]);
    let doc: unknown;
    try { doc = JSON.parse(plain.toString("utf8")); } finally { plain.fill(0); }
    if (!doc || typeof doc !== "object" || !Array.isArray((doc as { accounts?: unknown }).accounts)) throw new PilotBundleError();
    const accounts = (doc as { accounts: unknown[] }).accounts;
    if (accounts.length > 100) throw new PilotBundleError();
    let result: string | null = null; const ids = new Set<string>(); const usernames = new Set<string>(); const passwords = new Set<string>();
    for (const item of accounts) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new PilotBundleError();
      const r = item as Record<string, unknown>;
      if (typeof r.accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(r.accountId) || ids.has(r.accountId) ||
          typeof r.username !== "string" || usernames.has(r.username) ||
          typeof r.password !== "string" || passwords.has(r.password)) throw new PilotBundleError();
      ids.add(r.accountId); usernames.add(r.username); passwords.add(r.password);
      const config = buildTrustTunnelPilotConfig({ hostname: r.hostname as string, gatewayIpv4: r.gatewayIpv4 as string,
        port: r.port as number, username: r.username, password: r.password as string });
      if (r.accountId === accountId) result = config;
    }
    return result;
  } catch { throw new PilotBundleError(); }
}
