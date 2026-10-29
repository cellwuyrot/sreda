import {monitorHosts,monitorProjects} from "./projectMonitor";
let cached:{until:number;value:Awaited<ReturnType<typeof collect>>}|null=null;
let pending:Promise<Awaited<ReturnType<typeof collect>>>|null=null;
async function collect(){const [projects,hosts]=await Promise.all([monitorProjects(),monitorHosts()]);const unique=new Map();for(const h of hosts){if(!h.fresh||!h.report)continue;const old=unique.get(h.report.fingerprint);if(!old||Date.parse(old.report.sampledAt)<Date.parse(h.report.sampledAt))unique.set(h.report.fingerprint,h);}
 const fresh=[...unique.values()] as typeof hosts;let total=0,available=0,disks=0;
 for(const h of fresh)for(const d of h.report?.disks||[]){total+=d.total;available+=d.available;disks++;}
 const overloaded=fresh.filter(h=>h.report?.cpu!=null&&h.report.cpu>=90||h.report?.memoryAvailable!=null&&h.report.memoryTotal!=null&&h.report.memoryTotal>0&&h.report.memoryAvailable/h.report.memoryTotal<0.1).length;
 const cpuKnown=fresh.filter(h=>h.report?.cpu!=null||h.report?.memoryAvailable!=null).length;
 return {activeProjects:projects.filter(p=>p.state==="up").length,projectStates:{total:projects.length,up:projects.filter(p=>p.state==="up").length,degraded:projects.filter(p=>p.state==="degraded").length,down:projects.filter(p=>p.state==="down").length,unknown:projects.filter(p=>p.state==="unknown").length,disabled:projects.filter(p=>p.state==="disabled").length},storageUsage:disks?`${((total-available)/1073741824).toFixed(1)} / ${(total/1073741824).toFixed(1)} ГБ`:null,serverLoad:cpuKnown?`${overloaded} перегружено / ${cpuKnown} с данными`:null,hostsWithFreshData:fresh.length,hostsWithReports:hosts.length,measuredAt:new Date().toISOString()};
}
export async function systemMonitorSummary(){if(cached&&cached.until>Date.now())return cached.value;if(!pending)pending=collect().then(value=>{cached={until:Date.now()+15000,value};return value;}).finally(()=>{pending=null;});return pending;}
