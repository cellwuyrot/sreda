import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { getOrCreateKeyPair, exportKeysToJSON, importKeysFromJSON, getCachedSharedKey } from "./e2ee";
const remote = new Map<string, JsonWebKey>();
let failPost = false, ambiguous = false;
beforeEach(() => {
  remote.clear(); failPost = false; ambiguous = false;
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (failPost) return new Response("{}", { status: 500 });
      remote.set("alice", body.publicKey);
      if (ambiguous) throw new Error("reply lost after commit");
      return new Response("{}", { status: 200 });
    }
    return new Response(JSON.stringify({ publicKey: remote.get(new URL(url, "https://test").searchParams.get("userId")!) ?? null }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());
async function backup() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits", "deriveKey"]);
  return { publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey), privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey) };
}
async function read(key: string) {
  return new Promise<unknown>((resolve, reject) => {
    const req = indexedDB.open("trioz-e2ee", 1); req.onsuccess = () => {
      const db = req.result; const get = db.transaction("keys").objectStore("keys").get(key);
      get.onsuccess = () => { resolve(get.result); db.close(); }; get.onerror = () => reject(get.error);
    }; req.onerror = () => reject(req.error);
  });
}
it("isolates accounts on one browser", async () => {
  const a = await getOrCreateKeyPair("alice"), b = await getOrCreateKeyPair("bob");
  expect(a.publicKeyJwk.x).not.toBe(b.publicKeyJwk.x);
  expect((await getOrCreateKeyPair("alice")).publicKeyJwk).toEqual(a.publicKeyJwk);
});
it("compare-and-creates a single identity for concurrent tabs", async () => {
  const [a, b] = await Promise.all([getOrCreateKeyPair("alice"), getOrCreateKeyPair("alice")]);
  expect(a.publicKeyJwk).toEqual(b.publicKeyJwk);
});
it("retains active key when server rejects an import", async () => {
  const old = await getOrCreateKeyPair("alice"); failPost = true;
  expect(await importKeysFromJSON(JSON.stringify(await backup()), "alice", true)).toBe(false);
  expect((await read("account:alice:identity") as { publicKey: JsonWebKey }).publicKey).toEqual(old.publicKeyJwk);
  expect(await read(`account:alice:identity:history:${old.publicKeyJwk.x}:${old.publicKeyJwk.y}`)).toBeDefined();
});
it("recovers a staged key when server committed but reply was lost", async () => {
  const old = await getOrCreateKeyPair("alice"), next = await backup(); ambiguous = true;
  expect(await importKeysFromJSON(JSON.stringify(next), "alice", true)).toBe(false);
  expect((await getOrCreateKeyPair("alice")).publicKeyJwk).toEqual(next.publicKey);
  expect(await read(`account:alice:identity:history:${old.publicKeyJwk.x}:${old.publicKeyJwk.y}`)).toBeDefined();
});
it("rejects an unrelated public/private pair before publishing", async () => {
  const a = await backup(), b = await backup();
  expect(await importKeysFromJSON(JSON.stringify({ publicKey: a.publicKey, privateKey: b.privateKey }), "alice")).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects another account's backup", async () => {
  expect(await importKeysFromJSON(JSON.stringify({ ...await backup(), userId: "bob" }), "alice")).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it("does not pretend to export a non-extractable private key", async () => {
  await getOrCreateKeyPair("alice");
  await expect(exportKeysToJSON("alice")).rejects.toThrow("неизвлекаемый");
});
it("exports an explicitly imported extractable key with account binding", async () => {
  expect(await importKeysFromJSON(JSON.stringify(await backup()), "alice", true)).toBe(true);
  expect(JSON.parse((await exportKeysToJSON("alice"))!).userId).toBe("alice");
});

it("shared-key cache is isolated by own identity and peer key version", async () => {
  const a = await getOrCreateKeyPair("alice"), b = await getOrCreateKeyPair("bob");
  const peer1 = (await backup()).publicKey, peer2 = (await backup()).publicKey;
  const key = await getCachedSharedKey(a.privateKey, peer1, "peer");
  expect(await getCachedSharedKey(a.privateKey, peer1, "peer")).toBe(key);
  expect(await getCachedSharedKey(b.privateKey, peer1, "peer")).not.toBe(key);
  expect(await getCachedSharedKey(a.privateKey, peer2, "peer")).not.toBe(key);
});
it("only adopts a legacy key after matching it to the signed-in account", async () => {
  const original = await getOrCreateKeyPair("seed");
  const stored = await read("account:seed:identity");
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("trioz-e2ee", 1); request.onsuccess = () => {
      const db = request.result; const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(stored, "identity-keypair");
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  });
  const stranger = await getOrCreateKeyPair("bob");
  expect(stranger.publicKeyJwk).not.toEqual(original.publicKeyJwk);
  remote.set("alice", original.publicKeyJwk);
  expect((await getOrCreateKeyPair("alice")).publicKeyJwk).toEqual(original.publicKeyJwk);
});

it("keeps an intact active key usable while pending verification is offline", async () => {
  const old = await getOrCreateKeyPair("alice"); failPost = true;
  expect(await importKeysFromJSON(JSON.stringify(await backup()), "alice", true)).toBe(false);
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  expect((await getOrCreateKeyPair("alice")).publicKeyJwk).toEqual(old.publicKeyJwk);
});
