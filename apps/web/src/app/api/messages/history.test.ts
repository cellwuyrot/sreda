import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/connectPermissions", () => ({ getChannelPermissions: vi.fn() }));
vi.mock("@/lib/memberProfileOverrides", () => ({ applyMemberOverrides: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn(async () => null) }));
vi.mock("@/lib/socketEmit", () => ({ emitToChannel: vi.fn() }));
vi.mock("@/lib/presence", () => ({ isUserViewingChannel: vi.fn(() => false) }));
vi.mock("@/lib/createNotification", () => ({ createNotification: vi.fn(), createNotificationsBulk: vi.fn() }));
vi.mock("@/lib/moderation", () => ({ getActiveTimeout: vi.fn(async () => null) }));
vi.mock("@/lib/censorService", () => ({ checkCensor: vi.fn(async () => ({ matches: [], blocked: false })), recordCensorHits: vi.fn() }));
vi.mock("@/lib/groupAudit", () => ({ logGroupAction: vi.fn() }));
vi.mock("@/lib/serverMentions", () => ({ resolveGroupMentions: vi.fn(async () => ({ ids: [], everyone: false })) }));
import { getServerSession } from "next-auth";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { GET, POST } from "./route";
import { NextRequest } from "next/server";
const msg=(id:string)=>({id,channelId:"c",createdAt:new Date("2026-01-01"),content:"source quote",userId:"author",user:{id:"author",name:"Author",avatar:null},reads:[]});
beforeEach(()=>{
 vi.mocked(getServerSession).mockResolvedValue(row({user:{id:"u"}}));
 vi.mocked(getChannelPermissions).mockResolvedValue(row({canView:true,canPost:true}));
 prismaMock.channel.findUnique.mockResolvedValue(row({id:"c",groupId:"g",group:{paused:false},slowmode:0,type:"TEXT",postAccess:"ALL"}));
 prismaMock.groupMember.findMany.mockResolvedValue([]);
 prismaMock.groupMember.findUnique.mockResolvedValue(row({role:"ADMIN"}));
});
describe("addressed history",()=>{
 it("loads old targets directly with both pagination directions",async()=>{
  prismaMock.message.findFirst.mockResolvedValue(row({id:"old",createdAt:new Date("2026-01-01")}));
  prismaMock.message.findMany.mockResolvedValueOnce(row([msg("n1"),msg("n2"),msg("n3")])).mockResolvedValueOnce(row([msg("old"),msg("o1"),msg("o2")]));
  const res=await GET(new Request("http://localhost/api/messages?channelId=c&around=old&limit=2"));const data=await res.json();
  expect(data.messages.map((m:{id:string})=>m.id)).toEqual(["o1","old","n1","n2"]);
  expect(data.nextCursor).toBe("o1");expect(data.nextNewerCursor).toBe("n2");
  expect(prismaMock.message.findFirst.mock.calls[0][0]?.where).toMatchObject({id:"old",channelId:"c",threadId:null,deleted:false});
 });
 it("does not expose a target from a forbidden channel",async()=>{
  vi.mocked(getChannelPermissions).mockResolvedValue(row({canView:false}));
  expect((await GET(new Request("http://localhost/api/messages?channelId=c&around=hidden"))).status).toBe(403);
  expect(prismaMock.message.findFirst).not.toHaveBeenCalled();
 });
 it("reports a missing or deleted target",async()=>{
  prismaMock.message.findFirst.mockResolvedValue(null);
  expect((await GET(new Request("http://localhost/api/messages?channelId=c&around=gone"))).status).toBe(404);
 });
 it("fetches newer pages in chronological order",async()=>{
  prismaMock.message.findFirst.mockResolvedValue(row({id:"old",createdAt:new Date("2026-01-01")}));
  prismaMock.message.findMany.mockResolvedValueOnce(row([msg("n1"),msg("n2")]));
  const data=await (await GET(new Request("http://localhost/api/messages?channelId=c&after=old&limit=2"))).json();
  expect(data.messages.map((m:{id:string})=>m.id)).toEqual(["n1","n2"]);expect(data.nextNewerCursor).toBeNull();
 });
 it("continues ordinary older pagination with timestamp tie-breaks",async()=>{
  prismaMock.message.findMany.mockResolvedValueOnce(row([msg("new"),msg("older"),msg("extra")]));
  const data=await (await GET(new Request("http://localhost/api/messages?channelId=c&cursor=x&limit=2"))).json();
  expect(data.nextCursor).toBe("older");expect(prismaMock.message.findMany.mock.calls[0][0]).toMatchObject({cursor:{id:"x"},skip:1,orderBy:[{createdAt:"desc"},{id:"desc"}]});
 });
});
describe("quote persistence",()=>{
 const request=(body:object)=>new NextRequest("http://localhost/api/messages",{method:"POST",body:JSON.stringify({content:"answer",channelId:"c",...body})});
 it("persists the selected quote with the original message ID",async()=>{
  prismaMock.message.findUnique.mockResolvedValue(row({channelId:"c",content:"source quote",deleted:false}));
  prismaMock.message.create.mockResolvedValue(row(msg("answer")));
  prismaMock.groupMember.findMany.mockResolvedValue([]);
  const res=await POST(request({replyToId:"old",replyQuote:"quote"}));
  expect(res.status).toBe(200);expect(prismaMock.message.create.mock.calls[0][0]?.data).toMatchObject({replyToId:"old",replyQuote:"quote"});
 });
 it("rejects a forged fragment",async()=>{
  prismaMock.message.findUnique.mockResolvedValue(row({channelId:"c",content:"source quote",deleted:false}));
  expect((await POST(request({replyToId:"old",replyQuote:"invented"}))).status).toBe(400);expect(prismaMock.message.create).not.toHaveBeenCalled();
 });
 it("rejects quotes without a parent",async()=>expect((await POST(request({replyQuote:"quote"}))).status).toBe(400));
 it("rejects cross-channel and deleted parents",async()=>{
  for(const parent of [{channelId:"other",content:"quote",deleted:false},{channelId:"c",content:"quote",deleted:true}]){
   prismaMock.message.findUnique.mockResolvedValue(row(parent));expect((await POST(request({replyToId:"old",replyQuote:"quote"}))).status).toBe(400);
  }
 });
});
