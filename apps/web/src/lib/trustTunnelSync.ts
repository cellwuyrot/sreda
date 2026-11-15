/**
 * TRUSTTUNNEL-SUBSCRIBERS: database side of the credential lifecycle.
 *
 * Desired state = every enabled TrustTunnelAccess row whose account is entitled
 * RIGHT NOW (fresh DB read, `isTrustTunnelSubscriberAllowed`). The endpoint
 * agent pulls this snapshot, applies it, and acknowledges. Anything that drops
 * out (expired plan, ban, deletion, user switched it off, feature flag off) is
 * removed from the endpoint on the next agent cycle.
 */
import prisma from "./prisma";
import { getVpnSettings } from "./vpn";
import { isTrustTunnelSubscriberAllowed, type TrustTunnelSubscriberAccount } from "./trustTunnelSubscriberPolicy";
import {
  deriveUsername, TT_SYNC_MAX_USERS, TrustTunnelConfigError,
  type DesiredEntry, type SyncAck, type TrustTunnelServerSettings,
} from "./trustTunnelAccess";

export const ENTITLEMENT_SELECT = {
  id: true, role: true, isDeleted: true, banned: true, bannedUntil: true,
  isPremium: true, vpnAccess: true, vpnAccessUntil: true,
} as const;

const ISSUED_KEY = "trusttunnel.sync.issued";
const APPLIED_KEY = "trusttunnel.sync.applied";

export function trustTunnelEnabled(): boolean {
  return process.env.TRIOZ_TT_ENABLED === "true";
}

/** Disable synchronization when the feature or reliable connection service is off. */
export async function trustTunnelProviderIsActive(): Promise<boolean> {
  if (!trustTunnelEnabled()) return false;
  const settings = await getVpnSettings();
  return settings.enabled === true;
}

export function isEntitled(account: TrustTunnelSubscriberAccount | null, now: Date): boolean {
  return isTrustTunnelSubscriberAllowed({ enabled: process.env.TRIOZ_TT_ENABLED, account, now });
}

/** Complete snapshot or an exception — never a partial list (a partial list would revoke people). */
export async function computeDesiredEntries(now: Date): Promise<DesiredEntry[]> {
  // Disabling the feature or service removes managed logins on the next snapshot.
  // A DB failure throws and returns 503 so the agent keeps its last state.
  if (!(await trustTunnelProviderIsActive())) return [];
  const rows = await prisma.trustTunnelAccess.findMany({
    where: { disabledAt: null }, select: { userId: true, generation: true },
    orderBy: { userId: "asc" }, take: TT_SYNC_MAX_USERS + 1,
  });
  if (rows.length > TT_SYNC_MAX_USERS) throw new TrustTunnelConfigError();
  if (rows.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: ENTITLEMENT_SELECT });
  const byId = new Map(users.map((u) => [u.id, u as TrustTunnelSubscriberAccount]));
  return rows
    .filter((r) => Number.isSafeInteger(r.generation) && r.generation >= 1 && isEntitled(byId.get(r.userId) ?? null, now))
    .map((r) => ({ accountId: r.userId, generation: r.generation }));
}

/** `keys` are `username:generation` — enough to tell a rotated password apart, no secrets. */
interface IssuedRecord { serial: number; digest: string; keys: string[] }
interface AppliedRecord { serial: number; at: number; keys: string[]; ok: boolean; error: string | null }

async function readJson<T>(key: string): Promise<T | null> {
  const row = await prisma.siteConfig.findUnique({ where: { key } });
  if (!row) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}
async function writeJson(key: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  await prisma.siteConfig.upsert({ where: { key }, create: { key, value: text }, update: { value: text } });
}

/** Remember the last few issued snapshots (usernames only) to verify acknowledgements. */
export function issuedKeys(settings: TrustTunnelServerSettings, entries: readonly DesiredEntry[]): string[] {
  return entries.map((e) => `${deriveUsername(settings.credKey, e.accountId)}:${e.generation}`).sort();
}

export async function recordIssued(record: IssuedRecord): Promise<void> {
  const prev = (await readJson<IssuedRecord[]>(ISSUED_KEY)) ?? [];
  const list = [record, ...(Array.isArray(prev) ? prev : [])].slice(0, 5);
  await writeJson(ISSUED_KEY, list);
}

/** Accept an acknowledgement only for a snapshot this server actually issued. */
export async function recordAck(ack: SyncAck, now: Date): Promise<boolean> {
  const issued = (await readJson<IssuedRecord[]>(ISSUED_KEY)) ?? [];
  const match = Array.isArray(issued) ? issued.find((i) => i.serial === ack.serial && i.digest === ack.digest) : undefined;
  if (!match) return false;
  const prev = await readJson<AppliedRecord>(APPLIED_KEY);
  // ACKs may arrive late or out of order. Never let an older success (or
  // failure) overwrite a newer observation, regardless of its success flag.
  if (prev && prev.serial > ack.serial) return false;
  if (!ack.ok) {
    // Retain the last known keys for diagnostics, but advance the observed
    // serial and mark the state unconfirmed until a newer successful ACK.
    await writeJson(APPLIED_KEY, {
      serial: ack.serial, at: now.getTime(), keys: prev?.keys ?? [],
      ok: false, error: ack.error ?? "apply failed",
    });
    return true;
  }
  await writeJson(APPLIED_KEY, { serial: ack.serial, at: now.getTime(), keys: match.keys, ok: true, error: null });
  return true;
}

export interface EndpointStatus { applied: boolean; lastSyncAt: number | null; agentError: boolean }

/** Has the endpoint confirmed this account's current username? (No secrets involved.) */
export async function endpointStatusFor(settings: TrustTunnelServerSettings, accountId: string, generation: number): Promise<EndpointStatus> {
  const applied = await readJson<AppliedRecord>(APPLIED_KEY);
  if (!applied || !Array.isArray(applied.keys)) return { applied: false, lastSyncAt: null, agentError: false };
  const key = `${deriveUsername(settings.credKey, accountId)}:${generation}`;
  return {
    applied: applied.ok === true && applied.keys.includes(key),
    lastSyncAt: typeof applied.at === "number" ? applied.at : null,
    agentError: applied.ok === false,
  };
}
