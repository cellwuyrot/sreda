import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./ModalBackdrop",()=>({default:({children}:{children:React.ReactNode})=><div>{children}</div>}));
vi.mock("@/components/ui/InfoTooltip",()=>({default:()=>null}));
vi.mock("@/components/ui/ConnectIcons",()=>({XIcon:()=>null}));
import GlobalSearchModal from "./GlobalSearchModal";
afterEach(()=>vi.unstubAllGlobals());
const result=(id:string)=>({id,type:"messages",title:"Author",subtitle:"Chat",snippet:"needle",url:`/connect?group=g&channel=c&message=${id}`});
describe("global search pagination",()=>{
 it("loads older matches and deduplicates results",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({results:[result("new")],nextCursor:"new"})})
   .mockResolvedValueOnce({ok:true,json:async()=>({results:[result("new"),result("old")],nextCursor:null})});
  vi.stubGlobal("fetch",fetcher);render(<GlobalSearchModal onClose={()=>{}}/>);
  fireEvent.change(screen.getByPlaceholderText("Сообщение, задача, участник, статья..."),{target:{value:"needle"}});
  const button=await screen.findByText("Показать более старые сообщения");fireEvent.click(button);
  await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(screen.getAllByText("Author")).toHaveLength(2));
  expect(fetcher.mock.calls[1][0]).toContain("scope=messages&cursor=new");
  expect(screen.queryByText("Показать более старые сообщения")).toBeNull();
 });
 it("shows a search failure rather than stale matches",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:false,json:async()=>({error:"Forbidden"})})));
  render(<GlobalSearchModal onClose={()=>{}}/>);
  fireEvent.change(screen.getByPlaceholderText("Сообщение, задача, участник, статья..."),{target:{value:"needle"}});
  expect((await screen.findByRole("alert")).textContent).toContain("Не удалось выполнить поиск");
 });
 it("ignores a previous query response even if the transport resolves after abort",async()=>{
  let resolveOld:(value:unknown)=>void=()=>{};
  const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}))
   .mockResolvedValueOnce({ok:true,json:async()=>({results:[{...result("new"),title:"Fresh author"}],nextCursor:null})});
  vi.stubGlobal("fetch",fetcher);render(<GlobalSearchModal onClose={()=>{}}/>);
  const input=screen.getByPlaceholderText("Сообщение, задача, участник, статья...");
  fireEvent.change(input,{target:{value:"old"}});await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  fireEvent.change(input,{target:{value:"new"}});await screen.findByText("Fresh author");
  await act(async()=>resolveOld({ok:true,json:async()=>({results:[{...result("old"),title:"Old author"}],nextCursor:"old"})}));
  expect(screen.queryByText("Old author")).toBeNull();expect(screen.getByText("Fresh author")).not.toBeNull();
 });
});
