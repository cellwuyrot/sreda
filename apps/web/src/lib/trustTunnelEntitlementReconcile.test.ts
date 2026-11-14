import { describe, expect, it } from 'vitest';
import { planTrustTunnelEntitlements } from './trustTunnelEntitlementReconcile';
import type { TrustTunnelSubscriberAccount } from './trustTunnelSubscriberPolicy';

const now = new Date('2026-11-14T00:00:00Z');
const user = (id: string, patch: Partial<TrustTunnelSubscriberAccount> = {}): TrustTunnelSubscriberAccount => ({
  id, role:'USER', isDeleted:false, banned:false, bannedUntil:null, isPremium:false, vpnAccess:false, vpnAccessUntil:null, ...patch,
});
const plan = (accounts: TrustTunnelSubscriberAccount[], provisionedAccountIds: string[] = []) =>
  planTrustTunnelEntitlements({enabled:'true', complete:true, now, accounts, provisionedAccountIds});

describe('TrustTunnel complete entitlement snapshot planning', () => {
  it('plans additions, retained grants and revocations from current entitlement', () => {
    expect(plan([
      user('new_premium', {isPremium:true}), user('keep_vpn', {vpnAccess:true, vpnAccessUntil:new Date('2027-01-01')}),
      user('expired', {vpnAccess:true, vpnAccessUntil:now}), user('banned', {isPremium:true,banned:true}),
      user('project_admin', {role:'ADMIN'}), user('group_admin',{role:'GROUP_ADMIN'}), user('deleted',{isDeleted:true,isPremium:true}),
    ], ['keep_vpn','expired','banned','deleted','missing'])).toEqual({
      add:['new_premium','project_admin'], keep:['keep_vpn'], remove:['banned','deleted','expired','missing'],
    });
  });
  it('does not confuse a disabled or incomplete read with an empty desired snapshot', () => {
    expect(() => planTrustTunnelEntitlements({enabled:'false',complete:true,now,accounts:[],provisionedAccountIds:['a']})).toThrow();
    expect(() => planTrustTunnelEntitlements({enabled:'true',complete:false,now,accounts:[],provisionedAccountIds:['a']})).toThrow();
    expect(plan([],['a'])).toEqual({add:[],keep:[],remove:['a']});
  });
  it('aborts instead of mass revocation on invalid or duplicate account data', () => {
    expect(() => plan([user('a'), user('a')], ['a'])).toThrow();
    expect(() => plan([user('bad id')], ['a'])).toThrow();
    expect(() => plan([user('a',{vpnAccessUntil:new Date('invalid')})], ['a'])).toThrow();
    expect(() => plan([user('a',{bannedUntil:undefined as never})], ['a'])).toThrow();
    expect(() => plan([user('a',{isPremium:undefined as never})], ['a'])).toThrow();
  });
  it('rejects inconsistent provisioned state or invalid current time', () => {
    expect(() => plan([],['a','a'])).toThrow();
    expect(() => plan([],['bad id'])).toThrow();
    expect(() => planTrustTunnelEntitlements({enabled:'true',complete:true,now:new Date('invalid'),accounts:[],provisionedAccountIds:[]})).toThrow();
  });
  it('refuses current pilot capacity overflow without dropping users', () => {
    expect(() => plan(Array.from({length:101}, (_,i) => user(`user_${i}`,{isPremium:true})))).toThrow('Credential capacity exceeded');
    expect(() => plan([],Array.from({length:101}, (_,i) => `user_${i}`))).toThrow('Credential capacity exceeded');
  });
  it('is stable and preserves active grants across equivalent input ordering', () => {
    const a = user('a',{isPremium:true}), b = user('b',{vpnAccess:true}), c = user('c',{role:'ADMIN'});
    expect(plan([a,b,c],['b','a'])).toEqual(plan([c,b,a],['a','b']));
    expect(plan([a,b,c],['a','b'])).toEqual({add:['c'],keep:['a','b'],remove:[]});
  });
});
