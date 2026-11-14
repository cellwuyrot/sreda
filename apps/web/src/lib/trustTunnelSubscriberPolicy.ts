import { hasPremium } from './premium';
import { hasActiveVpnPlan } from './vpnPlan';

/** Fresh database record only. Never trust role/plan supplied by a client. */
export interface TrustTunnelSubscriberAccount {
  id: string;
  role: string;
  isDeleted: boolean;
  banned: boolean;
  bannedUntil: Date | null;
  isPremium: boolean;
  vpnAccess: boolean;
  vpnAccessUntil: Date | null;
}

/**
 * Authorization only: NOT provisioning or revocation on the endpoint. Do not
 * enable subscriber issuance until those lifecycles are implemented. Existing
 * project's hasPremium grants Premium to project ADMIN by role.
 */
export function isTrustTunnelSubscriberAllowed(input: {
  enabled: string | undefined;
  account: TrustTunnelSubscriberAccount | null;
  now: Date;
}): boolean {
  const { account, now } = input;
  if (input.enabled !== 'true' || !account || !/^[A-Za-z0-9_-]{1,128}$/.test(account.id) ||
      typeof account.role !== 'string' || account.isDeleted !== false ||
      typeof account.banned !== 'boolean' || typeof account.isPremium !== 'boolean' ||
      typeof account.vpnAccess !== 'boolean' || !(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
  if (account.banned && (!(account.bannedUntil instanceof Date) ||
      !Number.isFinite(account.bannedUntil.getTime()) || account.bannedUntil.getTime() > now.getTime())) return false;
  if (hasPremium(account)) return true;
  // Unlike the generic helper's legacy fallback, malformed/absent expiry must
  // not accidentally make a paid TrustTunnel plan permanent.
  if (account.vpnAccessUntil !== null &&
      (!(account.vpnAccessUntil instanceof Date) || !Number.isFinite(account.vpnAccessUntil.getTime()))) return false;
  return hasActiveVpnPlan(account, now);
}
