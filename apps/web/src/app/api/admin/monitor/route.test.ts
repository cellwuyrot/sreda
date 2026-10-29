import {afterEach,beforeEach,it,expect,vi} from "vitest";
import {prismaMock,row} from "@/test/prismaMock";
vi.mock("@/lib/prisma",()=>({default:prismaMock}));vi.mock("next-auth",()=>({getServerSession:vi.fn()}));vi.mock("@/lib/auth",()=>({authOptions:{}}));vi.mock("@/lib/projectMonitor",()=>({monitorProjects:vi.fn(async()=>[]),monitorHosts:vi.fn(async()=>[])}));
import {getServerSession} from "next-auth";import {GET,POST} from "./route";
// Explicit origin keeps these tests independent of developer and CI NEXTAUTH_URL.
const APP_ORIGIN="http://localhost:3000";
beforeEach(()=>{vi.stubEnv("NEXTAUTH_URL",APP_ORIGIN);vi.mocked(getServerSession).mockResolvedValue(row({user:{id:"admin",role:"ADMIN",username:"owner"}}));prismaMock.serverNode.findMany.mockResolvedValue([]);prismaMock.$transaction.mockImplementation(row(async(fn: (tx:typeof prismaMock)=>unknown)=>fn(prismaMock)));});
afterEach(()=>vi.unstubAllEnvs());
const req=(b:unknown,origin=APP_ORIGIN)=>new Request(`${APP_ORIGIN}/api/admin/monitor`,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(b)});
it.each(["USER","CONSULTANT","EDITOR"])("does not let %s list all projects or create bindings",async role=>{vi.mocked(getServerSession).mockResolvedValue(row({user:{id:"x",role}}));expect((await GET()).status).toBe(403);expect((await POST(req({}))).status).toBe(403);});
it("rejects cross-origin mutation",async()=>expect((await POST(req({},"https://evil.test"))).status).toBe(403));
it("returns no secret server columns",async()=>{await GET();expect(prismaMock.serverNode.findMany).toHaveBeenCalledWith({select:{id:true,name:true,enabled:true}});});
it("requires a consultant owner before project creation",async()=>{prismaMock.user.findFirst.mockResolvedValue(null);expect((await POST(req({action:"project",name:"shop",ownerId:"u"}))).status).toBe(409);expect(prismaMock.partnerProject.create).not.toHaveBeenCalled();});
it("creates an administrator-owned operation for a consultant",async()=>{prismaMock.user.findFirst.mockResolvedValue(row({id:"p",role:"CONSULTANT"}));expect((await POST(req({action:"project",name:"Shop",ownerId:"p"}))).status).toBe(200);expect(prismaMock.partnerProject.create).toHaveBeenCalledWith({data:{name:"Shop",ownerId:"p",purpose:expect.any(String),status:"IN_PROGRESS"}});expect(prismaMock.auditLog.create).toHaveBeenCalled();});
it("does not accept command-like PM2 selectors",async()=>{expect((await POST(req({action:"deployment",appName:"shop; rm -rf /",namespace:"default",required:true,healthRequired:true}))).status).toBe(409);expect(prismaMock.projectDeployment.create).not.toHaveBeenCalled();});

it("edits monitoring policy without deleting a binding or running a process command",async()=>{expect((await POST(req({action:"settings",id:"d",required:false,healthRequired:false}))).status).toBe(200);expect(prismaMock.projectDeployment.update).toHaveBeenCalledWith({where:{id:"d"},data:{required:false,healthRequired:false}});expect(prismaMock.projectDeployment.delete).not.toHaveBeenCalled();});

it("rejects an origin without the configured port",async()=>{expect((await POST(req({action:"settings",id:"d",required:false,healthRequired:false},"http://localhost"))).status).toBe(403);expect(prismaMock.projectDeployment.update).not.toHaveBeenCalled();});
it("rejects a missing Origin header",async()=>{const r=req({action:"settings",id:"d",required:false,healthRequired:false});r.headers.delete("Origin");expect((await POST(r)).status).toBe(403);expect(prismaMock.projectDeployment.update).not.toHaveBeenCalled();});
