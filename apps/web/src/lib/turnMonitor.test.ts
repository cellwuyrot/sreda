import {describe,it,expect} from 'vitest';import {turnMonitorView,type TurnNode} from './turnMonitor';
const now=2_000_000;
const node=(report:unknown,over:Partial<TurnNode>={}):TurnNode=>({id:'one',name:'Relay 1',enabled:true,lastSeenAt:new Date(now-1000),lastReport:JSON.stringify(report),...over});
describe('TURN monitor — honest local STUN status',()=>{
 it('reports a fresh local STUN response without credentials or unrelated fields',()=>{const out=turnMonitorView(node({serviceType:'VOICE',turnProbe:'stun_ok',turnCheckedAtMs:now-500,secret:'do-not-leak'}),now);expect(out.status).toBe('stun_ok');expect(JSON.stringify(out)).not.toContain('secret');});
 it.each(['timeout','error'] as const)('shows %s only when fresh',value=>expect(turnMonitorView(node({serviceType:'VOICE',turnProbe:value,turnCheckedAtMs:now-100}),now).status).toBe(value));
 it('shows unknown for stale heartbeat or probe',()=>{const report={serviceType:'VOICE',turnProbe:'stun_ok',turnCheckedAtMs:now};expect(turnMonitorView(node(report,{lastSeenAt:new Date(now-120001)}),now).status).toBe('unknown');expect(turnMonitorView(node({...report,turnCheckedAtMs:now-120001}),now).status).toBe('unknown');});
 it('does not infer TURN success from API or other media node',()=>{expect(turnMonitorView(node({apiStatus:'reachable'}),now).status).toBe('unknown');expect(turnMonitorView(node({turnProbe:'stun_ok',turnCheckedAtMs:now}),now).status).toBe('unknown');});
 it('ignores future, malformed and arbitrary results',()=>{expect(turnMonitorView(node({serviceType:'VOICE',turnProbe:'stun_ok',turnCheckedAtMs:now+30001}),now).status).toBe('unknown');expect(turnMonitorView(node({serviceType:'VOICE',turnProbe:'relay_works',turnCheckedAtMs:now}),now).status).toBe('unknown');expect(turnMonitorView(node({}, {lastReport:'bad'}),now).status).toBe('unknown');});
 it('marks disabled nodes without interpreting stale data',()=>expect(turnMonitorView(node({}, {enabled:false}),now).status).toBe('disabled'));
});
