import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {appMetric,allowedHealthUrl,cpuPercent} from "./policy.mjs";
const exec=promisify(execFile);
const config=JSON.parse(await fs.readFile(process.env.TRIOZ_MONITOR_CONFIG||"/etc/trioz-monitor/config.json","utf8"));
const origin=new URL(config.mainUrl||"https://trioz.ru");if(origin.protocol!=="https:"||origin.username||origin.password||origin.pathname!=="/"||!config.token||typeof config.token!=="string")throw Error("Configure HTTPS mainUrl and agent token");
const url=new URL("/api/monitor/report",origin).href;
const headers={Authorization:`Bearer ${config.token}`,"Content-Type":"application/json"};
const timeout=(ms)=>AbortSignal.timeout(ms);
const totals=()=>os.cpus().reduce((a,c)=>({idle:a.idle+c.times.idle,total:a.total+Object.values(c.times).reduce((n,v)=>n+v,0)}),{idle:0,total:0});
let previous=totals();const sizes=new Map();
let machine;try{machine=(await fs.readFile("/etc/machine-id","utf8")).trim();}catch{machine=os.hostname();}
const fingerprint=crypto.createHash("sha256").update(machine).digest("hex");
async function pm2Processes(){
 try{
  const home=config.pm2Home||process.env.PM2_HOME||path.join(os.homedir(),".pm2");
  const pid=Number((await fs.readFile(path.join(home,"pm2.pid"),"utf8")).trim());if(!Number.isInteger(pid)||pid<=0)return null;process.kill(pid,0);
  const {stdout}=await exec(config.pm2Bin||"pm2",["jlist"],{env:{...process.env,PM2_HOME:home},timeout:8000,maxBuffer:8*1024*1024});
  const rows=JSON.parse(stdout);return Array.isArray(rows)?rows:null;
 }catch{return null;}
}
async function health(id){const value=config.healthChecks?.[id];if(!value)return "unconfigured";const u=allowedHealthUrl(value);if(!u)return "failed";try{const r=await fetch(u,{signal:timeout(4000),redirect:"error",cache:"no-store"});await r.body?.cancel();return r.ok?"ok":"failed";}catch{return "failed";}}
// Project du runs outside the report path, at most one scan at a time.
// Unknown remains null until the first completed scan; failure never becomes zero.
const sizeQueue=new Set();let sizeScanning=false;
async function scanSizes(){if(sizeScanning)return;sizeScanning=true;try{for(const id of sizeQueue){sizeQueue.delete(id);let bytes=null;try{const real=await fs.realpath(config.projectPaths[id]);if(real==="/"||!(await fs.stat(real)).isDirectory())throw Error();const {stdout}=await exec("du",["--apparent-size","--block-size=1","-s","--",real],{timeout:15000,maxBuffer:8192});const n=Number(stdout.split(/\s/)[0]);if(Number.isSafeInteger(n)&&n>=0)bytes=n;}catch{}sizes.set(id,{at:Date.now(),bytes});}}finally{sizeScanning=false;}}
function projectSize(id){if(!config.projectPaths?.[id])return null;const cached=sizes.get(id);if(!cached||Date.now()-cached.at>=300000){sizeQueue.add(id);void scanSizes();}return cached&&Date.now()-cached.at<600000?cached.bytes:null;}
async function mapLimited(rows,fn){const out=new Array(rows.length);let next=0;await Promise.all(Array.from({length:Math.min(8,rows.length)},async()=>{while(next<rows.length){const i=next++;out[i]=await fn(rows[i]);}}));return out;}
async function disks(){const out=[],seen=new Set();for(const d of (config.disks||[{path:"/",label:"rootfs"}]).slice(0,20)){try{if(!/^[a-zA-Z0-9_. -]{1,60}$/.test(d.label))continue;const real=await fs.realpath(d.path);const st=await fs.stat(real);if(seen.has(st.dev))continue;const v=await fs.statfs(real);seen.add(st.dev);out.push({label:d.label,total:v.blocks*v.bsize,available:v.bavail*v.bsize});}catch{}}return out;}
async function memoryAvailable(){try{const m=(await fs.readFile("/proc/meminfo","utf8")).match(/^MemAvailable:\s+(\d+) kB/m);return m?Number(m[1])*1024:null;}catch{return null;}}
async function tick(){
 const response=await fetch(url,{headers,signal:timeout(10000),redirect:"error",cache:"no-store"});if(!response.ok)throw Error("config");const body=await response.json();if(!Array.isArray(body.deployments)||body.deployments.length>100)throw Error("config");
 const processes=await pm2Processes();const apps=await mapLimited(body.deployments,async d=>appMetric(d,processes,await health(d.id),projectSize(d.id)));
 const current=totals(),cpu=cpuPercent(previous,current);previous=current;
 const report={sampledAt:new Date().toISOString(),fingerprint,cpu,memoryTotal:os.totalmem(),memoryAvailable:await memoryAvailable(),load1:os.loadavg()[0],cores:os.cpus().length,disks:await disks(),apps};
 const r=await fetch(url,{method:"POST",headers,body:JSON.stringify(report),signal:timeout(10000),redirect:"error"});await r.body?.cancel();if(!r.ok)throw Error("report");console.log(`[monitor] Report accepted; applications: ${apps.length}; PM2 data: ${processes?"available":"unavailable"}`);
}
while(true){try{await tick();}catch{console.error("[monitor] Collection/delivery failed. Check configuration, permissions, clock and connectivity; no stale sample is resent.");}await new Promise(r=>setTimeout(r,30000));}
