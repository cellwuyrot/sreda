import { expect, it } from "vitest";
import { checkedJson } from "./clientResponse";
it.each([403, 500])("rejects HTTP %s with API message", async status => {
  await expect(checkedJson(new Response('{"error":"Не сохранено"}', {status}))).rejects.toThrow("Не сохранено");
});
it("handles a non-JSON proxy error", async()=>{await expect(checkedJson(new Response('bad gateway',{status:502}),"Сбой сервера")).rejects.toThrow("Сбой сервера");});
it("rejects an incomplete success response",async()=>{await expect(checkedJson(new Response('',{status:200}))).rejects.toThrow("неполный ответ");});
it("returns only confirmed JSON", async()=>expect(await checkedJson(new Response('{"ok":true}'))).toEqual({ok:true}));
