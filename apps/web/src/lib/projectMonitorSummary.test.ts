import {it,expect,vi} from "vitest";
vi.mock("./projectMonitor",()=>({monitorProjects:vi.fn(),monitorHosts:vi.fn()}));
import {monitorProjects,monitorHosts} from "./projectMonitor";
import {systemMonitorSummary} from "./projectMonitorSummary";
it("counts projects once and deduplicates the same host, excluding stale data",async()=>{
 const report={sampledAt:new Date().toISOString(),fingerprint:"same",cpu:95,memoryTotal:100,memoryAvailable:20,disks:[{label:"root",total:1073741824,available:536870912}]};
 vi.mocked(monitorProjects).mockResolvedValue([{state:"up"},{state:"unknown"},{state:"disabled"}] as never);
 vi.mocked(monitorHosts).mockResolvedValue([{fresh:true,report},{fresh:true,report},{fresh:false,report:{...report,fingerprint:"old"}}] as never);
 const a=await systemMonitorSummary();expect(a.activeProjects).toBe(1);expect(a.hostsWithFreshData).toBe(1);expect(a.storageUsage).toBe("0.5 / 1.0 ГБ");expect(a.serverLoad).toBe("1 перегружено / 1 с данными");
 await systemMonitorSummary();expect(monitorProjects).toHaveBeenCalledTimes(1);
});
