// Node.js 24: local pure-policy tests; no servers or network are contacted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTrustTunnelPilotAllowed } from '../apps/web/src/lib/trustTunnelPilotPolicy.ts';
const base = () => ({enabled:'true', allowedAdminIds:'a1,a2', now:new Date('2026-11-14T00:00:00Z'), account:{id:'a1',role:'ADMIN',isDeleted:false,banned:false,bannedUntil:null}});
test('explicit project admin only', () => {
  assert.equal(isTrustTunnelPilotAllowed(base()), true);
  for(const role of ['USER','EDITOR','OWNER','MODERATOR']) assert.equal(isTrustTunnelPilotAllowed({...base(), account:{...base().account,role}}),false);
  for(const id of ['a3','', 'a 1']) assert.equal(isTrustTunnelPilotAllowed({...base(), account:{...base().account,id}}),false);
});
test('disabled or invalid configuration fails closed', () => {
  for(const enabled of [undefined,'false','TRUE','1']) assert.equal(isTrustTunnelPilotAllowed({...base(),enabled}),false);
  for(const allowedAdminIds of [undefined,'','*','a1,','a1,not allowed']) assert.equal(isTrustTunnelPilotAllowed({...base(),allowedAdminIds}),false);
  assert.equal(isTrustTunnelPilotAllowed({...base(),account:null}),false);
});
test('deleted, banned, invalid time denied', () => {
  assert.equal(isTrustTunnelPilotAllowed({...base(),account:{...base().account,isDeleted:true}}),false);
  for(const bannedUntil of [null,new Date('2026-12-01'),new Date('bad')]) assert.equal(isTrustTunnelPilotAllowed({...base(),account:{...base().account,banned:true,bannedUntil}}),false);
  assert.equal(isTrustTunnelPilotAllowed({...base(),account:{...base().account,banned:true,bannedUntil:new Date('2026-01-01')}}),true);
  assert.equal(isTrustTunnelPilotAllowed({...base(),now:new Date('bad')}),false);
});
