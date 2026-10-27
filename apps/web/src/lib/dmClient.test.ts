import { describe, it, expect, vi } from "vitest";
vi.mock("./e2ee", () => ({ encryptMessage: vi.fn() }));
import { encryptMessage } from "./e2ee";
import { mergeDmMessages, prepareDmContent } from "./dmClient";
const key = {} as CryptoKey, peer = {} as JsonWebKey;
describe("DM outgoing content", () => {
  it("preserves normal text", async () => expect(await prepareDmContent(false,"hello",null,null)).toBe("hello"));
  it("refuses unavailable keys", async () => { await expect(prepareDmContent(true,"secret",null,peer)).rejects.toThrow("Нет ключей"); });
  it("never falls back to plaintext after crypto failure", async () => { vi.mocked(encryptMessage).mockRejectedValueOnce(Error("crypto")); await expect(prepareDmContent(true,"secret",key,peer)).rejects.toThrow("не отправлено"); });
  it("passes ciphertext on success", async () => { vi.mocked(encryptMessage).mockResolvedValueOnce("e2ee:encrypted"); expect(await prepareDmContent(true,"secret",key,peer)).toBe("e2ee:encrypted"); });
  it("does not permit attachment-only secure sends", async () => { await expect(prepareDmContent(true,"",key,peer)).rejects.toThrow("только текст"); });
});
describe("DM optimistic reconciliation", () => {
  const pending = { id:"opt-a",clientMessageId:"client-a",userId:"u1",createdAt:"2026-01-01",status:"sending" };
  const saved = { ...pending,id:"real-a",status:"sent" };
  it("deduplicates socket echo and HTTP acknowledgement", () => { const first=mergeDmMessages([pending],[saved]); expect(mergeDmMessages(first,[saved])).toEqual([saved]); });
  it("does not replace unrelated pending message", () => { expect(mergeDmMessages([pending],[{...saved,id:"other",clientMessageId:"client-b"}])).toHaveLength(2); });
  it("does not match another user's client id", () => { expect(mergeDmMessages([pending],[{...saved,userId:"u2"}])).toHaveLength(2); });
});
