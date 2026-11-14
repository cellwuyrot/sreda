import { isTrustTunnelSubscriberAllowed, type TrustTunnelSubscriberAccount } from './trustTunnelSubscriberPolicy';

/**
 * Compute a full intended credential membership snapshot, without secrets,
 * database writes, network calls, or server restarts. Caller must get a
 * consistent and complete account snapshot and must separately serialize and
 * implement endpoint apply, acknowledgement and credential revocation.
 * Any malformed or incomplete input aborts the WHOLE plan rather than
 * accidentally revoking everybody or approving a partial entitlement snapshot.
 */
export function planTrustTunnelEntitlements(input: {
  enabled: string | undefined;
  complete: boolean;
  now: Date;
  accounts: TrustTunnelSubscriberAccount[];
  provisionedAccountIds: string[];
}): { add: string[]; keep: string[]; remove: string[] } {
  const idValid = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  const dateOrNull = (date: unknown): date is Date | null => date === null || (date instanceof Date && Number.isFinite(date.getTime()));
  if (input.enabled !== 'true' || input.complete !== true || !(input.now instanceof Date) ||
      !Number.isFinite(input.now.getTime()) || !Array.isArray(input.accounts) ||
      !Array.isArray(input.provisionedAccountIds)) throw new Error('Incomplete or disabled entitlement reconciliation');
  const current = new Set<string>();
  for (const id of input.provisionedAccountIds) {
    if (!idValid(id) || current.has(id)) throw new Error('Invalid provisioned account snapshot');
    current.add(id);
  }
  // The existing encrypted pilot bundle and Endpoint planner cap accounts at 100.
  // Refuse instead of silently dropping subscribers; production must remove
  // this bound through a separately designed scalable credential lifecycle.
  if (current.size > 100) throw new Error('Credential capacity exceeded');
  const seen = new Set<string>();
  const desired = new Set<string>();
  for (const account of input.accounts) {
    if (!account || !idValid(account.id) || seen.has(account.id) || typeof account.role !== 'string' ||
        !account.role || typeof account.isDeleted !== 'boolean' || typeof account.banned !== 'boolean' ||
        typeof account.isPremium !== 'boolean' || typeof account.vpnAccess !== 'boolean' ||
        !dateOrNull(account.bannedUntil) || !dateOrNull(account.vpnAccessUntil))
      throw new Error('Invalid account snapshot');
    seen.add(account.id);
    if (isTrustTunnelSubscriberAllowed({enabled:'true',account,now:input.now})) desired.add(account.id);
  }
  if (desired.size > 100) throw new Error('Credential capacity exceeded');
  const sort = (items: string[]) => items.sort();
  return {
    add: sort([...desired].filter(id => !current.has(id))),
    keep: sort([...desired].filter(id => current.has(id))),
    remove: sort([...current].filter(id => !desired.has(id))),
  };
}
