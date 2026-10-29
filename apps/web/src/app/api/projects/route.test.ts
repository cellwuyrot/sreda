import {beforeEach,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import {prismaMock,row} from "@/test/prismaMock";
vi.mock("@/lib/prisma",()=>({default:prismaMock}));vi.mock("next-auth",()=>({getServerSession:vi.fn()}));vi.mock("@/lib/auth",()=>({authOptions:{}}));vi.mock("@/lib/createNotification",()=>({createNotification:vi.fn()}));
import {getServerSession} from "next-auth";import {GET,POST} from "./route";
beforeEach(()=>{vi.mocked(getServerSession).mockResolvedValue(row({user:{id:"partner",role:"CONSULTANT"}}));});
it("consultant cannot create a project",async()=>{const r=await POST(new NextRequest("http://localhost/api/projects",{method:"POST",body:"{}"}));expect(r.status).toBe(403);expect(prismaMock.partnerProject.create).not.toHaveBeenCalled();});
it("consultant staff query cannot expose another owner",async()=>{prismaMock.partnerProject.findMany.mockResolvedValue([]);await GET(new NextRequest("http://localhost/api/projects?scope=staff"));expect(prismaMock.partnerProject.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{ownerId:"partner"}}));});
