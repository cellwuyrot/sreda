// Only these fields leave the host. PM2 environment, paths and logs never do.
export function appMetric(deployment, processes, healthy="unconfigured",storageBytes=null) {
 const rows=processes?.filter(p=>p.name===deployment.appName&&(p.pm2_env?.namespace||"default")===deployment.namespace);
 if(!rows)return {deploymentId:deployment.id,state:"unknown",instances:0,cpu:null,memory:null,restarts:null,uptimeSeconds:null,health:healthy,storageBytes};
 const finite=(n)=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
 const sum=(get)=>rows.every(p=>finite(get(p)))?rows.reduce((n,p)=>n+get(p),0):null;
 const times=rows.map(p=>p.pm2_env?.pm_uptime).filter(finite);
 return {deploymentId:deployment.id,state:!rows.length?"missing":rows.every(p=>p.pm2_env?.status==="online")?"online":rows.some(p=>p.pm2_env?.status==="errored")?"errored":"stopped",instances:rows.length,cpu:rows.length?sum(p=>p.monit?.cpu):null,memory:rows.length?sum(p=>p.monit?.memory):null,restarts:rows.length?sum(p=>p.pm2_env?.restart_time):null,uptimeSeconds:times.length===rows.length&&times.length?Math.max(0,Math.floor((Date.now()-Math.max(...times))/1000)):null,health:healthy,storageBytes};
}
export function allowedHealthUrl(value){try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)&&["127.0.0.1","[::1]"].includes(u.hostname)&&!u.username&&!u.password?u:null;}catch{return null;}}
export function cpuPercent(before,after){const idle=after.idle-before.idle,total=after.total-before.total;return total>0&&idle>=0?Math.max(0,Math.min(100,100*(1-idle/total))):null;}
