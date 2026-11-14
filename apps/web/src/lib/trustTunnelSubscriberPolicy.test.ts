import { describe, expect, it } from 'vitest';
import { isTrustTunnelSubscriberAllowed, type TrustTunnelSubscriberAccount } from './trustTunnelSubscriberPolicy';

const now = new Date('2026-11-14T00:00:00Z');
const account = (): TrustTunnelSubscriberAccount => ({ id:'user_1', role:'USER', isDeleted:false, banned:false,
  bannedUntil:null, isPremium:false, vpnAccess:false, vpnAccessUntil:null });
const allowed = (change: Partial<TrustTunnelSubscriberAccount> = {}, enabled: string | undefined = 'true') =>
  isTrustTunnelSubscriberAllowed({ enabled, account:{ ...account(), ...change }, now });

describe('subscriber TrustTunnel authorization (not provisioning)', () => {
  it('denies by default and rejects ordinary accounts', () => {
    expect(isTrustTunnelSubscriberAllowed({enabled:undefined,account:{...account(),isPremium:true},now})).toBe(false);
    expect(allowed({isPremium:true}, 'false')).toBe(false);
    expect(allowed()).toBe(false);
  });
  it('permits current Premium and current independent VPN plan', () => {
    expect(allowed({isPremium:true})).toBe(true);
    expect(allowed({vpnAccess:true, vpnAccessUntil:new Date('2026-11-15T00:00:00Z')})).toBe(true);
    expect(allowed({vpnAccess:true, vpnAccessUntil:null})).toBe(true);
  });
  it('rejects expired VPN plans and does not grant Premium with VPN only', () => {
    expect(allowed({vpnAccess:true, vpnAccessUntil:new Date('2026-11-14T00:00:00Z')})).toBe(false);
    expect(allowed({vpnAccess:false, vpnAccessUntil:new Date('2027-01-01')})).toBe(false);
    expect(allowed({vpnAccess:true, vpnAccessUntil:new Date('invalid')})).toBe(false);
  });
  it('retains existing project-level ADMIN Premium rule, not group roles', () => {
    expect(allowed({role:'ADMIN'})).toBe(true);
    expect(allowed({role:'GROUP_ADMIN'})).toBe(false);
  });
  it('denies deleted users and active or malformed bans', () => {
    expect(allowed({isPremium:true,isDeleted:true})).toBe(false);
    expect(allowed({isPremium:true,banned:true})).toBe(false);
    expect(allowed({isPremium:true,banned:true,bannedUntil:new Date('invalid')})).toBe(false);
    expect(allowed({isPremium:true,banned:true,bannedUntil:new Date('2026-11-15')})).toBe(false);
    expect(allowed({isPremium:true,banned:true,bannedUntil:new Date('2026-01-01')})).toBe(true);
  });
  it('denies invalid clocks, malformed identifiers and absent accounts', () => {
    expect(allowed({id:'x;--',isPremium:true})).toBe(false);
    expect(isTrustTunnelSubscriberAllowed({enabled:'true',account:null,now})).toBe(false);
    expect(isTrustTunnelSubscriberAllowed({enabled:'true',account:account(),now:new Date('invalid')})).toBe(false);
  });
});
