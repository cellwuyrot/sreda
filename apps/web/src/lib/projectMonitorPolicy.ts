export const FRESH_MS = 120000;
export type AppMetric = {deploymentId:string; state:"online"|"stopped"|"errored"|"missing"|"unknown"; instances:number; cpu:number|null; memory:number|null; restarts:number|null; uptimeSeconds:number|null; health:"ok"|"failed"|"unconfigured"; storageBytes:number|null};
export type HostMetric = {sampledAt:string; fingerprint:string; cpu:number|null; memoryTotal:number|null; memoryAvailable:number|null; load1:number|null; cores:number|null; disks:{label:string;total:number;available:number}[]; apps:AppMetric[]};
const num=(v:unknown,max=Number.MAX_SAFE_INTEGER):number|null=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=max?v:null;
export function parseMonitorReport(raw:unknown,allowed:Set<string>,now=Date.now()):HostMetric {
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Некорректный отчёт");
 const b=raw as Record<string,unknown>;const ts=Date.parse(String(b.sampledAt));
 if(!Number.isFinite(ts)||ts>now+60000||ts<now-300000||!Array.isArray(b.apps)||b.apps.length>100||!Array.isArray(b.disks)||b.disks.length>20||!/^([a-f0-9]{64})$/.test(String(b.fingerprint)))throw Error("Некорректное время или размер отчёта");
 const seen=new Set<string>(); const apps=b.apps.map((value:unknown)=>{if(!value||typeof value!=="object")throw Error("Некорректное приложение");const a=value as Record<string,unknown>;const id=String(a.deploymentId);if(!allowed.has(id)||seen.has(id))throw Error("Чужое или повторное размещение");seen.add(id);
 if(!["online","stopped","errored","missing","unknown"].includes(String(a.state))||!["ok","failed","unconfigured"].includes(String(a.health)))throw Error("Некорректное состояние");
 return {deploymentId:id,state:a.state,health:a.health,instances:num(a.instances,10000)??0,cpu:num(a.cpu,100000),memory:num(a.memory),restarts:num(a.restarts),uptimeSeconds:num(a.uptimeSeconds),storageBytes:num(a.storageBytes)} as AppMetric;});
 const labels=new Set<string>(); const disks=b.disks.map((v:unknown)=>{if(!v||typeof v!=="object")throw Error("Некорректный диск");const d=v as Record<string,unknown>;const label=String(d.label);const total=num(d.total),available=num(d.available);if(!/^[a-zA-Z0-9_. -]{1,60}$/.test(label)||labels.has(label)||total===null||available===null||available>total)throw Error("Некорректный диск");labels.add(label);return {label,total,available};});
 const memoryTotal=num(b.memoryTotal),memoryAvailable=num(b.memoryAvailable);if(memoryTotal!==null&&memoryAvailable!==null&&memoryAvailable>memoryTotal)throw Error("Некорректная память");
 return {sampledAt:new Date(ts).toISOString(),fingerprint:String(b.fingerprint),cpu:num(b.cpu,100),memoryTotal,memoryAvailable,load1:num(b.load1),cores:num(b.cores,100000),disks,apps};
}
export function readReport(raw:string|null|undefined):HostMetric|null {try{return raw?JSON.parse(raw):null;}catch{return null;}}
export function deploymentState(d:{id:string;enabled:boolean;healthRequired:boolean;node:{enabled:boolean;monitorSeenAt:Date|null;monitorReport:string|null}},now=Date.now()) {
 if(!d.enabled||!d.node.enabled)return "disabled";
 const report=readReport(d.node.monitorReport);
 if(!d.node.monitorSeenAt||now-d.node.monitorSeenAt.getTime()>FRESH_MS||!report||now-Date.parse(report.sampledAt)>FRESH_MS)return "unknown";
 const a=report.apps.find(a=>a.deploymentId===d.id);if(!a||a.state==="unknown")return "unknown";
 if(a.state!=="online"||a.health==="failed")return "down";
 if(d.healthRequired&&a.health!=="ok")return "unknown";
 return "up";
}
export function projectState(states:{state:string;required:boolean}[]) {
 const enabled=states.filter(d=>d.state!=="disabled");if(!enabled.length)return "disabled";
 const mandatory=enabled.filter(d=>d.required);const needed=mandatory.length?mandatory:enabled;
 if(needed.every(d=>d.state==="up"))return enabled.every(d=>d.state==="up")?"up":"degraded";
 if(needed.some(d=>d.state==="unknown"))return needed.some(d=>d.state==="up")?"degraded":"unknown";
 return needed.some(d=>d.state==="up")?"degraded":"down";
}
export const MONITOR_LABELS:Record<string,string>={up:"Работает",degraded:"Частично работает",down:"Недоступен",unknown:"Нет свежих данных / проверки",disabled:"Отключён / не настроен"};
