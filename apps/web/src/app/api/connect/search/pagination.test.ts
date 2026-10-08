import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma",()=>({default:prismaMock}));
vi.mock("next-auth",()=>({getServerSession:vi.fn()}));
vi.mock("@/lib/auth",()=>({authOptions:{}}));
vi.mock("@/lib/rateLimit",()=>({rateLimit:vi.fn(async()=>null)}));
vi.mock("@/lib/connectPermissions",()=>({getChannelPermissionsBatch:vi.fn()}));
import { getServerSession } from "next-auth";
import { getChannelPermissionsBatch } from "@/lib/connectPermissions";
import { NextRequest } from "next/server";
import { GET } from "./route";
beforeEach(()=>{
 vi.mocked(getServerSession).mockResolvedValue(row({user:{id:"u"}}));
 prismaMock.groupMember.findMany.mockResolvedValue(row([{groupId:"g",group:{name:"Group"}}]));
 prismaMock.channel.findMany.mockResolvedValue(row([{id:"allowed",name:"Chat",groupId:"g"},{id:"hidden",name:"Hidden",groupId:"g"}]));
 vi.mocked(getChannelPermissionsBatch).mockResolvedValue(row(new Map([["allowed",{canView:true}],["hidden",{canView:false}]])));
});
describe("search pagination",()=>{
 it("returns a cursor for older results and preserves channel permissions",async()=>{
  const messages=Array.from({length:31},(_,i)=>({id:`m${i}`,content:"needle",channelId:"allowed",createdAt:new Date(),user:{name:"Author"}}));
  prismaMock.message.findMany.mockResolvedValue(row(messages));
  const res=await GET(new NextRequest("http://localhost/api/connect/search?q=needle&scope=messages"));const data=await res.json();
  expect(data.results).toHaveLength(30);expect(data.nextCursor).toBe("m29");
  expect(data.results[0].url).toContain("message=m0");
  expect(prismaMock.message.findMany.mock.calls[0][0]).toMatchObject({where:{channelId:{in:["allowed"]},deleted:false},take:31,orderBy:[{createdAt:"desc"},{id:"desc"}]});
 });
 it("uses the returned cursor without an age cutoff",async()=>{
  prismaMock.message.findMany.mockResolvedValue(row([{id:"ancient",content:"needle",channelId:"allowed",createdAt:new Date("2020-01-01"),user:{name:"Author"}}]));
  const data=await (await GET(new NextRequest("http://localhost/api/connect/search?q=needle&scope=messages&cursor=m29"))).json();
  expect(data.results[0].id).toBe("ancient");expect(data.nextCursor).toBeNull();
  const args=prismaMock.message.findMany.mock.calls[0][0];expect(args).toMatchObject({cursor:{id:"m29"},skip:1});expect(args?.where).not.toHaveProperty("createdAt");
 });
 it("does not query messages if all channels are forbidden",async()=>{
  vi.mocked(getChannelPermissionsBatch).mockResolvedValue(new Map());
  expect((await (await GET(new NextRequest("http://localhost/api/connect/search?q=needle&scope=messages"))).json()).results).toEqual([]);
  expect(prismaMock.message.findMany).not.toHaveBeenCalled();
 });
});
