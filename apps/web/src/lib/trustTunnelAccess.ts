/**
 * TRUSTTUNNEL-SUBSCRIBERS: pure credential lifecycle primitives.
 *
 * Credentials are never stored in plaintext in the database. They are derived
 * on demand from a server-only master key (TRIOZ_TT_CRED_KEY) plus the opaque
 * per-account record (`TrustTunnelAccess.generation`). Rotating = generation+1:
 * after the endpoint agent applies the next desired state, the old password
 * stops working. Revocation = the account drops out of the desired state.
 *
 * The desired state is delivered to the endpoint host only by the pull agent
 * (deploy/trusttunnel/trioz-tt-sync.*), encrypted with AES-256-GCM under a
 * separate sync key (TRIOZ_TT_SYNC_KEY), so a TLS-terminating proxy or an
 * access log never sees passwords. Nothing here logs or returns secrets except
 * the explicit config builders.
 */
import { createCipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { buildTrustTunnelPilotConfig } from "./trustTunnelClientConfig";

export const TT_SYNC_AAD = "trioz-trusttunnel-sync-v1";
export const TT_SYNC_MAX_USERS = 300;
/** Desired state older than this is rejected by the agent (replay window). */
export const TT_SYNC_TTL_MS = 10 * 60 * 1000;

export class TrustTunnelConfigError extends Error {
  constructor() { super("TrustTunnel is not configured"); }
}

export interface TrustTunnelServerSettings {
  credKey: Buffer;
  syncKey: Buffer;
  syncTokenSha256: Buffer;
  hostname: string;
  gatewayIpv4: string;
  port: number;
}

const HEX64 = /^[0-9a-f]{64}$/i;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * All settings are mandatory; any missing/malformed value makes the feature
 * unavailable (fail closed) instead of silently falling back to defaults.
 */
export function loadTrustTunnelSettings(env: Record<string, string | undefined> = process.env): TrustTunnelServerSettings {
  const credKey = env.TRIOZ_TT_CRED_KEY ?? "";
  const syncKey = env.TRIOZ_TT_SYNC_KEY ?? "";
  const tokenHash = env.TRIOZ_TT_SYNC_TOKEN_SHA256 ?? "";
  const hostname = env.TRIOZ_TT_HOSTNAME ?? "";
  const gatewayIpv4 = env.TRIOZ_TT_GATEWAY_IPV4 ?? "";
  const port = Number(env.TRIOZ_TT_PORT ?? "8443");
  if (!HEX64.test(credKey) || !HEX64.test(syncKey) || !HEX64.test(tokenHash) ||
      credKey.toLowerCase() === syncKey.toLowerCase() || !HOST.test(hostname) ||
      isIP(gatewayIpv4) !== 4 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TrustTunnelConfigError();
  }
  return {
    credKey: Buffer.from(credKey, "hex"), syncKey: Buffer.from(syncKey, "hex"),
    syncTokenSha256: Buffer.from(tokenHash, "hex"), hostname, gatewayIpv4, port,
  };
}

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Opaque, stable endpoint username; does not reveal the account id. */
export function deriveUsername(credKey: Buffer, accountId: string): string {
  if (credKey.length !== 32 || !ACCOUNT_ID.test(accountId)) throw new TrustTunnelConfigError();
  return "trioz_" + createHmac("sha256", credKey).update("tt-user-v1|" + accountId).digest("hex").slice(0, 32);
}

/** 256-bit password, base64url (43 chars) — format accepted by all clients. */
export function derivePassword(credKey: Buffer, username: string, generation: number): string {
  if (credKey.length !== 32 || !/^trioz_[a-f0-9]{32}$/.test(username) ||
      !Number.isSafeInteger(generation) || generation < 1) throw new TrustTunnelConfigError();
  return createHmac("sha256", credKey).update(`tt-pass-v1|${username}|${generation}`).digest("base64url");
}

export function buildSubscriberConfig(settings: TrustTunnelServerSettings, accountId: string, generation: number): string {
  const username = deriveUsername(settings.credKey, accountId);
  return buildTrustTunnelPilotConfig({
    hostname: settings.hostname, gatewayIpv4: settings.gatewayIpv4, port: settings.port,
    username, password: derivePassword(settings.credKey, username, generation),
  });
}

/** Constant-time agent token check against the configured SHA-256. */
export function isValidSyncToken(settings: TrustTunnelServerSettings, authorization: string | null): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice(7).trim();
  if (token.length < 32 || token.length > 200) return false;
  const actual = createHash("sha256").update(token, "utf8").digest();
  return actual.length === settings.syncTokenSha256.length && timingSafeEqual(actual, settings.syncTokenSha256);
}

export interface DesiredEntry { accountId: string; generation: number }

/** Digest of the username set only (no passwords) — used for acknowledgements. */
export function usernamesDigest(usernames: readonly string[]): string {
  return createHash("sha256").update([...usernames].sort().join("\n"), "utf8").digest("hex");
}

export interface SealedDesiredState { sealed: string; serial: number; digest: string; usernames: string[] }

/**
 * Seal the COMPLETE desired credential snapshot for the endpoint agent.
 * The serial is the issue timestamp; the agent rejects anything older than
 * what it already applied and anything outside the TTL window.
 */
export function sealDesiredState(settings: TrustTunnelServerSettings, entries: readonly DesiredEntry[], now: Date,
  iv: Buffer = randomBytes(12)): SealedDesiredState {
  if (entries.length > TT_SYNC_MAX_USERS || iv.length !== 12) throw new TrustTunnelConfigError();
  const seen = new Set<string>();
  const users = entries.map((entry) => {
    if (seen.has(entry.accountId)) throw new TrustTunnelConfigError();
    seen.add(entry.accountId);
    const username = deriveUsername(settings.credKey, entry.accountId);
    return { username, password: derivePassword(settings.credKey, username, entry.generation) };
  }).sort((a, b) => (a.username < b.username ? -1 : 1));
  const serial = now.getTime();
  const usernames = users.map((u) => u.username);
  const plain = Buffer.from(JSON.stringify({ v: 1, serial, issuedAt: serial, expiresAt: serial + TT_SYNC_TTL_MS, users }), "utf8");
  try {
    const cipher = createCipheriv("aes-256-gcm", settings.syncKey, iv);
    cipher.setAAD(Buffer.from(TT_SYNC_AAD));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const sealed = ["v1", iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
    return { sealed, serial, digest: usernamesDigest(usernames), usernames };
  } finally { plain.fill(0); }
}

export interface SyncAck { serial: number; ok: boolean; digest: string; error: string | null }

/** Strict parser for the agent acknowledgement body; never trusts extra fields. */
export function parseSyncAck(value: unknown): SyncAck | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.serial) || (v.serial as number) <= 0 || typeof v.ok !== "boolean" ||
      typeof v.digest !== "string" || !/^[0-9a-f]{64}$/.test(v.digest)) return null;
  const error = typeof v.error === "string" ? v.error.replace(/[^\w .:,()-]/g, "").slice(0, 120) : null;
  return { serial: v.serial as number, ok: v.ok, digest: v.digest, error };
}
