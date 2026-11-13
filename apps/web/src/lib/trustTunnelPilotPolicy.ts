/**
 * TrustTunnel pilot authorization policy. Not an authentication mechanism.
 * Callers must obtain `account` freshly from the database for the authenticated
 * session user, on every protected operation. Never use a group membership role,
 * request body, WebView flag, or stale session role as this account record.
 *
 * This file does not enable the pilot, issue credentials, or switch providers.
 */
export interface PilotAccount {
  id: string;
  role: string;
  isDeleted: boolean;
  banned: boolean;
  bannedUntil: Date | null;
}

export interface PilotPolicyInput {
  enabled: string | undefined;
  allowedAdminIds: string | undefined;
  account: PilotAccount | null;
  now: Date;
}

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Fail closed if disabled, config malformed, account missing, deleted or banned. */
export function isTrustTunnelPilotAllowed(input: PilotPolicyInput): boolean {
  if (input.enabled !== "true" || !input.account || !input.allowedAdminIds) return false;
  const { account } = input;
  if (!ACCOUNT_ID.test(account.id) || account.role !== "ADMIN" || account.isDeleted !== false ||
      typeof account.banned !== "boolean" || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) return false;
  const ids = input.allowedAdminIds.split(",").map((id) => id.trim());
  if (!ids.length || ids.some((id) => !ACCOUNT_ID.test(id))) return false;
  if (!ids.includes(account.id)) return false;
  if (account.banned) {
    if (!(account.bannedUntil instanceof Date) || !Number.isFinite(account.bannedUntil.getTime()) ||
        account.bannedUntil.getTime() > input.now.getTime()) return false;
  }
  return true;
}
