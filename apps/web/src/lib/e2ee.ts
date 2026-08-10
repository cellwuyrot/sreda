"use client";

const DB_NAME = "trioz-e2ee";
const STORE_NAME = "keys";
const KEY_ID = "identity-keypair";

interface StoredKeyPair {
  publicKey: JsonWebKey;
  privateKey: CryptoKey;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getOrCreateKeyPair(): Promise<{ publicKeyJwk: JsonWebKey; privateKey: CryptoKey }> {
  const db = await openDB();

  const existing = await new Promise<StoredKeyPair | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(KEY_ID);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (existing) {
    db.close();
    return { publicKeyJwk: existing.publicKey, privateKey: existing.privateKey };
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey", "deriveBits"]
  );

  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ publicKey: publicKeyJwk, privateKey: keyPair.privateKey }, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
  return { publicKeyJwk, privateKey: keyPair.privateKey };
}

async function deriveSharedKey(privateKey: CryptoKey, peerPublicKeyJwk: JsonWebKey): Promise<CryptoKey> {
  const peerPublicKey = await crypto.subtle.importKey(
    "jwk",
    peerPublicKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    256
  );

  return crypto.subtle.importKey(
    "raw",
    sharedBits,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

const E2EE_PREFIX = "e2ee:";

export async function encryptMessage(
  plaintext: string,
  privateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey
): Promise<string> {
  const sharedKey = await deriveSharedKey(privateKey, peerPublicKeyJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    encoded
  );

  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, "0")).join("");
  const ctHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, "0")).join("");

  return `${E2EE_PREFIX}${ivHex}:${ctHex}`;
}

export async function decryptMessage(
  encrypted: string,
  privateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey
): Promise<string> {
  if (!encrypted.startsWith(E2EE_PREFIX)) return encrypted;

  const data = encrypted.slice(E2EE_PREFIX.length);
  const [ivHex, ctHex] = data.split(":");
  if (!ivHex || !ctHex) return encrypted;

  const sharedKey = await deriveSharedKey(privateKey, peerPublicKeyJwk);
  const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const ct = new Uint8Array(ctHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    ct
  );

  return new TextDecoder().decode(decrypted);
}

export function isE2EEMessage(content: string): boolean {
  return content.startsWith(E2EE_PREFIX);
}

export async function encryptFile(
  data: ArrayBuffer,
  privateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey
): Promise<{ encrypted: ArrayBuffer; iv: string }> {
  const sharedKey = await deriveSharedKey(privateKey, peerPublicKeyJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    data
  );

  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, "0")).join("");
  return { encrypted, iv: ivHex };
}

export async function decryptFile(
  encrypted: ArrayBuffer,
  ivHex: string,
  privateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey
): Promise<ArrayBuffer> {
  const sharedKey = await deriveSharedKey(privateKey, peerPublicKeyJwk);
  const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));

  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    encrypted
  );
}

const keyCache = new Map<string, CryptoKey>();

export async function getCachedSharedKey(
  privateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey,
  peerId: string
): Promise<CryptoKey> {
  const cached = keyCache.get(peerId);
  if (cached) return cached;

  const key = await deriveSharedKey(privateKey, peerPublicKeyJwk);
  keyCache.set(peerId, key);
  return key;
}

/* ── Backup / Restore ── */

export async function exportKeysToJSON(): Promise<string | null> {
  const db = await openDB();
  const stored = await new Promise<StoredKeyPair | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(KEY_ID);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!stored) return null;

  let privateJwk: JsonWebKey | null = null;
  try {
    privateJwk = await crypto.subtle.exportKey("jwk", stored.privateKey);
  } catch {
    // key was generated non-extractable — regenerate as extractable
    const kp = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
    const pubJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    // save new extractable pair
    const db2 = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db2.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ publicKey: pubJwk, privateKey: kp.privateKey }, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db2.close();
    // upload new public key
    try {
      await fetch("/api/e2ee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: JSON.stringify(pubJwk) }),
      });
    } catch {}
    return JSON.stringify({ publicKey: pubJwk, privateKey: privJwk });
  }

  return JSON.stringify({ publicKey: stored.publicKey, privateKey: privateJwk });
}

export async function importKeysFromJSON(json: string): Promise<boolean> {
  try {
    const { publicKey, privateKey: privJwk } = JSON.parse(json);
    if (!publicKey || !privJwk) return false;

    const importedPrivate = await crypto.subtle.importKey(
      "jwk",
      privJwk,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );

    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ publicKey, privateKey: importedPrivate }, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    // update public key on server
    await fetch("/api/e2ee", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: JSON.stringify(publicKey) }),
    });

    keyCache.clear();
    return true;
  } catch {
    return false;
  }
}
