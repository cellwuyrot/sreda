/** Local listener check and agent heartbeat, NOT a TURN relay test. */
export type TurnNode = {id:string;name:string;enabled:boolean;lastSeenAt:Date|null;lastReport:string|null};
export type TurnStatus = 'stun_ok'|'timeout'|'error'|'unknown'|'disabled';
export function turnMonitorView(node:TurnNode,now=Date.now()) {
 let report:Record<string,unknown>={};
 try {const parsed=JSON.parse(node.lastReport??'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))report=parsed;} catch {/* corrupt report */}
 const lastSeen=node.lastSeenAt?.getTime();
 const agentFresh=typeof lastSeen==='number'&&Number.isFinite(lastSeen)&&now-lastSeen>=-30000&&now-lastSeen<=120000;
 const checked=report.turnCheckedAtMs;
 const probeFresh=typeof checked==='number'&&Number.isSafeInteger(checked)&&now-checked>=-30000&&now-checked<=120000;
 const known=report.serviceType==='VOICE';
 const result=report.turnProbe;
 const status:TurnStatus=!node.enabled?'disabled':known&&agentFresh&&probeFresh&&(result==='stun_ok'||result==='timeout'||result==='error')?result:'unknown';
 return {id:node.id,name:node.name,enabled:node.enabled,service:known?'VOICE':'unknown',agentFresh,receivedAt:node.lastSeenAt?.toISOString()??null,checkedAt:probeFresh?new Date(checked as number).toISOString():null,status};
}
