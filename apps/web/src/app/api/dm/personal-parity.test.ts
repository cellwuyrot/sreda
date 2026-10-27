import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/socketEmit", () => ({ emitToUser: vi.fn() }));
vi.mock("@/lib/createNotification", () => ({ createNotification: vi.fn().mockResolvedValue(null), markSubjectNotificationsRead: vi.fn().mockResolvedValue({ unreadLeft: 0 }) }));
import { getServerSession } from "next-auth";
import { emitToUser } from "@/lib/socketEmit";
const conv = { id: "c1", user1Id: "u1", user2Id: "u2", kind: "PERSONAL" };
const params = { params: Promise.resolve({ id: "c1" }) };
function req(path: string, body?: unknown, method = "POST") { return new NextRequest(`http://localhost${path}`, body === undefined ? undefined : { method, headers: { "content-type":"application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getServerSession).mockResolvedValue(row({ user:{id:"u1",name:"One"} })); prismaMock.directConversation.findUnique.mockResolvedValue(row(conv)); prismaMock.dmUserSetting.findUnique.mockResolvedValue(null); });

describe("SECURE API invariants", () => {
  beforeEach(() => prismaMock.directConversation.findUnique.mockResolvedValue(row({ ...conv,kind:"SECURE" })));
  it.each([{content:"secret"},{content:"e2ee:secret"},{content:"",attachments:[{url:"/uploads/x"}]}])("rejects plaintext and attachment sends", async body => {
    const { POST } = await import("./[id]/route"); const res=await POST(req("/api/dm/c1",body),params); expect(res.status).toBe(400); expect(prismaMock.directMessage.create).not.toHaveBeenCalled();
  });
  it("rejects plaintext edits before writing", async () => { const { PATCH }=await import("./[id]/route"); expect((await PATCH(req("/api/dm/c1",{messageId:"m1",content:"plain"},"PATCH"),params)).status).toBe(400); expect(prismaMock.directMessage.update).not.toHaveBeenCalled(); });
  it("does not index secure text in search", async () => { const { GET }=await import("./[id]/search/route"); expect((await GET(req("/api/dm/c1/search?q=secret"),params)).status).toBe(400); expect(prismaMock.directMessage.findMany).not.toHaveBeenCalled(); });
  it("does not return secure materials", async () => { const { GET }=await import("./[id]/attachments/route"); expect((await GET(req("/api/dm/c1/attachments"),params)).status).toBe(400); });
});
describe("history and search authorization", () => {
  it("requires authentication", async () => { vi.mocked(getServerSession).mockResolvedValue(null); const { GET }=await import("./[id]/search/route"); expect((await GET(req("/api/dm/c1/search?q=hello"),params)).status).toBe(401); });
  it("forbids nonparticipant admin", async () => { vi.mocked(getServerSession).mockResolvedValue(row({user:{id:"outsider",role:"ADMIN"}})); const { GET }=await import("./[id]/search/route"); expect((await GET(req("/api/dm/c1/search?q=hello"),params)).status).toBe(403); });
  it("search is scoped, excludes deleted/encrypted, and paginates", async () => { prismaMock.directMessage.findMany.mockResolvedValue(Array.from({length:31},(_,n)=>row({id:`m${n}`}))); const { GET }=await import("./[id]/search/route"); const res=await GET(req("/api/dm/c1/search?q=hello"),params); const data=await res.json(); expect(data.items).toHaveLength(30); expect(data.nextCursor).toBe("m29"); expect(prismaMock.directMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{conversationId:"c1",deleted:false,encrypted:false,content:{contains:"hello",mode:"insensitive"}}})); });
  it("rejects cursor from another conversation", async () => { prismaMock.directMessage.findFirst.mockResolvedValue(null); const { GET }=await import("./[id]/route"); expect((await GET(req("/api/dm/c1?around=foreign"),params)).status).toBe(404); expect(prismaMock.directMessage.findMany).not.toHaveBeenCalled(); });
  it("rejects phantom thread query", async () => { const { GET }=await import("./[id]/route"); expect((await GET(req("/api/dm/c1?threadId=m1"),params)).status).toBe(400); });
  it("loads older and newer context with bounded queries", async () => { prismaMock.directMessage.findFirst.mockResolvedValue(row({id:"m1",conversationId:"c1"})); prismaMock.directMessage.findMany.mockResolvedValueOnce([row({id:"m0"})]).mockResolvedValueOnce([row({id:"m1"}),row({id:"m2"})]); const { GET }=await import("./[id]/route"); const data=await (await GET(req("/api/dm/c1?around=m1&limit=1"),params)).json(); expect(data.messages.map((x:{id:string})=>x.id)).toEqual(["m0","m1"]); expect(data.afterCursor).toBe("m1"); });
});
describe("persistent DM reactions", () => {
  beforeEach(() => { prismaMock.directMessage.findUnique.mockResolvedValue(row({id:"m1",conversationId:"c1",conversation:conv,deleted:false})); prismaMock.directMessageReaction.findMany.mockResolvedValue([]); prismaMock.dmUserSetting.findFirst.mockResolvedValue(null); });
  it("uses idempotent upsert and emits to both participants", async () => { const { POST }=await import("./reactions/route"); const body={messageId:"m1",emoji:"👍",active:true}; expect((await POST(req("/api/dm/reactions",body))).status).toBe(200); expect(prismaMock.directMessageReaction.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{messageId_userId_emoji:{messageId:"m1",userId:"u1",emoji:"👍"}}})); expect(emitToUser).toHaveBeenCalledWith("u2","dm-reaction-added",expect.objectContaining({messageId:"m1",conversationId:"c1"})); });
  it("explicit remove is idempotent", async () => { const { POST }=await import("./reactions/route"); await POST(req("/api/dm/reactions",{messageId:"m1",emoji:"👍",active:false})); expect(prismaMock.directMessageReaction.deleteMany).toHaveBeenCalledWith({where:{messageId:"m1",userId:"u1",emoji:"👍"}}); });
  it("rejects nonparticipant", async () => { vi.mocked(getServerSession).mockResolvedValue(row({user:{id:"outsider"}})); const { POST }=await import("./reactions/route"); expect((await POST(req("/api/dm/reactions",{messageId:"m1",emoji:"👍",active:true}))).status).toBe(403); expect(prismaMock.directMessageReaction.upsert).not.toHaveBeenCalled(); });
  it("rejects deleted message", async () => { prismaMock.directMessage.findUnique.mockResolvedValue(row({deleted:true})); const { POST }=await import("./reactions/route"); expect((await POST(req("/api/dm/reactions",{messageId:"m1",emoji:"👍",active:true}))).status).toBe(404); });
  it("respects blacklist", async () => { prismaMock.dmUserSetting.findFirst.mockResolvedValue(row({blacklisted:true})); const { POST }=await import("./reactions/route"); expect((await POST(req("/api/dm/reactions",{messageId:"m1",emoji:"👍",active:true}))).status).toBe(403); });
  it("requires explicit desired state", async () => { const { POST }=await import("./reactions/route"); expect((await POST(req("/api/dm/reactions",{messageId:"m1",emoji:"👍"}))).status).toBe(400); });
});
describe("receipt privacy", () => {
  it("updates own read state but emits no forbidden receipt", async () => { const { POST }=await import("./read/route"); const res=await POST(req("/api/dm/read",{conversationId:"c1",sendReceipt:false})); expect(res.status).toBe(200); expect(prismaMock.directConversation.update).toHaveBeenCalledWith({where:{id:"c1"},data:{user1ReadAt:expect.any(Date)}}); expect(emitToUser).not.toHaveBeenCalled(); });
  it("emits and separately persists allowed receipt", async () => { const { POST }=await import("./read/route"); await POST(req("/api/dm/read",{conversationId:"c1",sendReceipt:true})); expect(prismaMock.directConversation.update).toHaveBeenCalledWith({where:{id:"c1"},data:{user1ReadAt:expect.any(Date),user1ReceiptAt:expect.any(Date)}}); expect(emitToUser).toHaveBeenCalledWith("u2","dm-read",expect.objectContaining({conversationId:"c1"})); });
});

describe("message contracts", () => {
  it("returns an existing clientMessageId without writing or notifying twice", async () => {
    prismaMock.directMessage.findUnique.mockResolvedValue(row({ id:"saved",clientMessageId:"client-1234",content:"hello" }));
    const { POST }=await import("./[id]/route");
    const res=await POST(req("/api/dm/c1",{content:"hello",clientMessageId:"client-1234"}),params);
    expect(res.status).toBe(200); expect((await res.json()).id).toBe("saved"); expect(prismaMock.directMessage.create).not.toHaveBeenCalled(); expect(emitToUser).not.toHaveBeenCalled();
  });
  it.each([{content:42},{content:"hello",clientMessageId:"bad!"},{content:"hello",threadId:"m1"}])("rejects invalid message fields", async body => { const { POST }=await import("./[id]/route"); expect((await POST(req("/api/dm/c1",body),params)).status).toBe(400); });
  it("rejects fabricated selected quote", async () => { prismaMock.directMessage.findUnique.mockResolvedValue(row({conversationId:"c1",deleted:false,content:"original"})); const { POST }=await import("./[id]/route"); expect((await POST(req("/api/dm/c1",{content:"reply",replyToId:"m1",replyQuote:"fabricated"}),params)).status).toBe(400); });
  it("paginates the materials index without the old 500-message cutoff", async () => { prismaMock.directMessage.findMany.mockResolvedValue(Array.from({length:51},(_,i)=>row({id:`m${i}`,attachments:JSON.stringify([{url:"/uploads/a",name:"A",isE2EE:true,e2eeIv:"iv"}]),createdAt:new Date(),user:{name:"One"}}))); const { GET }=await import("./[id]/attachments/route"); const data=await (await GET(req("/api/dm/c1/attachments"),params)).json(); expect(data.items).toHaveLength(50); expect(data.nextCursor).toBe("m49"); expect(data.items[0].e2eeIv).toBe("iv"); });
});
