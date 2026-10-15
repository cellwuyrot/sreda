import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { prismaMock } from "@/test/prismaMock";
import { encryptTzData } from "@/lib/tzIdCrypto";
import { GET, PUT } from "./route";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/prisma", async () => { const { prismaMock } = await import("@/test/prismaMock"); return { default: prismaMock, prisma: prismaMock }; });
const auth = vi.mocked(getServerSession);
function request(body: unknown, origin = "https://trioz.ru") { return new NextRequest("https://trioz.ru/api/admin/tz-id/project-admins?clientId=c1", { method: "PUT", headers: { Origin: origin }, body: JSON.stringify(body) }); }
const input = { clientId: "c1", userId: "u1", enabled: true };
beforeEach(() => {
 vi.clearAllMocks(); process.env.NEXTAUTH_URL = "https://trioz.ru"; process.env.TZ_ID_STORAGE_KEY = Buffer.alloc(32,5).toString("base64");
 auth.mockResolvedValue({user:{id:"admin",role:"ADMIN",name:"Administrator"}} as never);
 prismaMock.tzIdClient.findUnique.mockResolvedValue({id:"c1",enabled:true,metadata:encryptTzData({scope:"openid roles:read",token_endpoint_auth_method:"client_secret_basic"})} as never);
 prismaMock.user.findUnique.mockResolvedValue({id:"u1",isDeleted:false} as never);
 prismaMock.$transaction.mockImplementation(async (fn: unknown) => (fn as (tx: typeof prismaMock)=>Promise<unknown>)(prismaMock) as never);
});
it("denies non-admin and cross-origin grant writes",async()=>{
 auth.mockResolvedValue({user:{id:"u1",role:"USER"}} as never);expect((await PUT(request(input))).status).toBe(403);
 expect((await GET(request(input))).status).toBe(403);
 auth.mockResolvedValue({user:{id:"admin",role:"ADMIN"}} as never);expect((await PUT(request(input,"https://evil.invalid"))).status).toBe(403);
 expect(prismaMock.tzIdProjectRole.upsert).not.toHaveBeenCalled();
});
it("writes an exact project/user grant and append-only audit in one transaction",async()=>{
 expect((await PUT(request(input))).status).toBe(200);
 expect(prismaMock.tzIdProjectRole.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{clientId_userId:{clientId:"c1",userId:"u1"}},update:{role:"ADMIN",revokedAt:null}}));
 expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:"grant",targetId:"u1",details:"client=c1; role=ADMIN"})}));
});
it("revokes without deleting history",async()=>{
 expect((await PUT(request({...input,enabled:false}))).status).toBe(200);
 expect(prismaMock.tzIdProjectRole.upsert).toHaveBeenCalledWith(expect.objectContaining({update:{role:"ADMIN",revokedAt:expect.any(Date)}}));
});
it.each([{...input,enabled:"yes"},{...input,clientId:""},{...input,userId:null}])("rejects malformed grant %j",async body=>{expect((await PUT(request(body))).status).toBe(400);expect(prismaMock.tzIdProjectRole.upsert).not.toHaveBeenCalled();});
it("cannot assign unknown/deleted users",async()=>{prismaMock.user.findUnique.mockResolvedValue(null);expect((await PUT(request(input))).status).toBe(404);});
it("cannot assign public clients or clients without roles scope",async()=>{
 for (const meta of [{scope:"openid roles:read",token_endpoint_auth_method:"none"},{scope:"openid",token_endpoint_auth_method:"client_secret_basic"}]) {
 prismaMock.tzIdClient.findUnique.mockResolvedValue({id:"c1",enabled:true,metadata:encryptTzData(meta)} as never);
 expect((await PUT(request(input))).status).toBe(400);
 }
 expect(prismaMock.tzIdProjectRole.upsert).not.toHaveBeenCalled();
});
