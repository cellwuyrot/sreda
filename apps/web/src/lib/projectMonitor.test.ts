import {it,expect,vi} from "vitest";
import {prismaMock,row} from "@/test/prismaMock";
vi.mock("./prisma",()=>({default:prismaMock}));
import {monitorProjects} from "./projectMonitor";
it("forces owner filter and exposes only bound application metrics without host data",async()=>{
 const own={deploymentId:"mine",state:"online",health:"ok",cpu:5};
 const report={sampledAt:new Date().toISOString(),fingerprint:"private-host",memoryTotal:9999,apps:[own,{deploymentId:"other",cpu:80}]};
 prismaMock.partnerProject.findMany.mockResolvedValue(row([{id:"p",name:"Shop",ownerId:"partner",domain:"",deployments:[{id:"mine",nodeId:"private-node",appName:"shop",namespace:"default",enabled:true,required:true,healthRequired:true,node:{id:"private-node",name:"Private host",enabled:true,monitorSeenAt:new Date(),monitorReport:JSON.stringify(report)}}]}]));
 const result=await monitorProjects("partner");expect(prismaMock.partnerProject.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{ownerId:"partner"}}));
 const text=JSON.stringify(result);expect(text).not.toContain("private-node");expect(text).not.toContain("private-host");expect(text).not.toContain("Private host");expect(text).not.toContain('"other"');expect(result[0].deployments[0].metrics).toEqual(own);
});
