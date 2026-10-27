import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import DMPanel from "./DMPanel";
const noop = () => {};
const { stable } = vi.hoisted(() => ({ stable: () => {} }));
vi.mock("@/hooks/useMobile", () => ({ useMobile: () => false }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id:"u1" } } }) }));
vi.mock("socket.io-client", () => ({ io: () => ({ on: () => {}, emit: () => {}, disconnect: () => {} }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/e2ee", () => ({ getOrCreateKeyPair: async () => { throw Error("no keys"); }, ensurePublicKeyPublished: async () => "error", isE2EEMessage: (s:string) => s.startsWith("e2ee:"), decryptMessage: async(s:string) => s, encryptMessage: vi.fn() }));
vi.mock("@/lib/desktop", () => ({ getDesktopApi: () => null }));
vi.mock("@/components/connect/hooks/useMobileHistoryStack", () => ({ useHistoryLayer: () => {} }));
vi.mock("@/hooks/useMessageWindow", () => ({ useMessageWindow: (n:number) => ({start:0,end:n,padTop:0,padBottom:0,hiddenAbove:0,sync:stable,reveal:stable,revealTail:stable,reset:stable}) }));
vi.mock("./DMConversationList", () => ({ default: ({ conversations,onSelect }: {conversations:{id:string}[],onSelect:(id:string)=>void}) => <nav>{conversations.map(c => <button key={c.id} onClick={() => onSelect(c.id)}>Open {c.id}</button>)}</nav> }));
vi.mock("./DMPersonalHeader", () => ({ default: () => <header>Personal header</header> }));
vi.mock("./DMMessageList", () => ({ default: ({messages}:{messages:{id:string,content:string}[]}) => <div>{messages.map(m => <p key={m.id}>{m.content}</p>)}</div> }));
vi.mock("./DMMessageComposer", () => ({ default: ({input,onInputChange,onSend}:{input:string,onInputChange:(s:string)=>void,onSend:()=>void}) => <form onSubmit={e=>{e.preventDefault();onSend();}}><input aria-label="Message" value={input} onChange={e=>onInputChange(e.target.value)}/><button type="submit">Send</button></form> }));
vi.mock("@/components/connect/ForwardPendingBar", () => ({ default: () => null }));
const other={id:"u2",name:"Two",username:"two",avatar:null,role:"USER",avatarGlowEnabled:false,avatarGlowColors:null};
const conversations=[{id:"a",other},{id:"b",other},{id:"secure",secure:true,other}];
const result=(x:unknown)=>new Response(JSON.stringify(x),{headers:{"content-type":"application/json"}});
let requests: {url:string,body:unknown}[];
beforeEach(() => {
  requests=[]; localStorage.clear();
  vi.stubGlobal("fetch",vi.fn(async (url:string,options?:RequestInit)=>{
    if(options?.method==="POST") { requests.push({url,body:options.body}); return result({ok:true}); }
    if(url==="/api/dm")return result(conversations);
    if(url.startsWith("/api/dm/pin"))return result([]);
    if(url.startsWith("/api/dm/settings"))return result({});
    if(url.startsWith("/api/e2ee"))return result({publicKey:null});
    return result({messages:[],nextCursor:null});
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("DMPanel conversation boundaries",()=>{
  it("discards a late response for previous conversation",async()=>{
    let resolveA: (r:Response)=>void = noop;
    const original=fetch;
    vi.stubGlobal("fetch",vi.fn((url:string,options?:RequestInit)=> url.startsWith("/api/dm/a?") ? new Promise<Response>(resolve=>{resolveA=resolve;}) : original(url,options)));
    render(<DMPanel currentUserId="u1" initialFriendId={null} onClose={noop}/>);
    await screen.findByText("Open a");fireEvent.click(screen.getByText("Open a"));
    await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([u])=>String(u).startsWith("/api/dm/a?"))).toBe(true));
    fireEvent.click(screen.getByText("Open b"));await screen.findByLabelText("Message");
    await act(async()=>{resolveA(result({messages:[{id:"old",content:"STALE A MESSAGE"}],nextCursor:null}));});
    expect(screen.queryByText("STALE A MESSAGE")).toBeNull();
  });
  it("does not mark unread history as read after a failed load",async()=>{
    const original=fetch;
    vi.stubGlobal("fetch",vi.fn((url:string,options?:RequestInit)=>url.startsWith("/api/dm/a?") ? Promise.resolve(new Response("failed",{status:500})) : original(url,options)));
    render(<DMPanel currentUserId="u1" initialFriendId={null} onClose={noop}/>);
    fireEvent.click(await screen.findByText("Open a"));
    await screen.findByText(/Не удалось загрузить историю/);
    expect(requests.some(r=>r.url==="/api/dm/read")).toBe(false);
  });
  it("never sends plaintext from secure conversation when keys are absent",async()=>{
    render(<DMPanel currentUserId="u1" initialFriendId={null} onClose={noop}/>);
    fireEvent.click(await screen.findByText("Open secure"));
    fireEvent.change(await screen.findByLabelText("Message"),{target:{value:"secret"}});fireEvent.click(screen.getByText("Send"));
    await screen.findByText(/Нет ключей для защищённой отправки/);
    expect(requests.some(r=>r.url==="/api/dm/secure")).toBe(false);
    expect(localStorage.getItem("tz-chat-draft:dm:secure")).toBeNull();
    expect((screen.getByLabelText("Message") as HTMLInputElement).value).toBe("secret");
  });
});
