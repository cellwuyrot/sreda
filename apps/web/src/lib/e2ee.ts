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

function accountKey(userId: string): string {
  if (!userId) throw new Error("Account required for E2EE keys");
  return `account:${userId}:identity`;
}

async function readKey(db: IDBDatabase, key: string): Promise<StoredKeyPair | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function writeKey(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function samePublic(a: JsonWebKey, b: JsonWebKey): boolean {
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;
}

async function serverKey(userId: string): Promise<JsonWebKey | null> {
  const response = await fetch(`/api/e2ee?userId=${encodeURIComponent(userId)}`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Cannot verify account key");
  return (await response.json()).publicKey ?? null;
}

export async function getOrCreateKeyPair(userId: string): Promise<{ publicKeyJwk: JsonWebKey; privateKey: CryptoKey }> {
  return withIdentityLock(userId, () => getOrCreateKeyPairUnlocked(userId));
}
async function getOrCreateKeyPairUnlocked(userId: string): Promise<{ publicKeyJwk: JsonWebKey; privateKey: CryptoKey }> {
  const id = accountKey(userId);
  const db = await openDB();
  try {
    // A network error can happen AFTER the server accepted the staged key.
    // Recover that operation instead of discarding the previous identity.
    let existing = await readKey(db, id);
    const pending = await readKey(db, `${id}:pending`);
    if (pending) {
      try {
        const remote = await serverKey(userId);
        if (remote && samePublic(remote, pending.publicKey)) { await writeKey(db, id, pending); existing = pending; }
      } catch (error) {
        // Offline verification must not lock the user out of an intact active
        // identity. Never promote the unverified pending key in this branch.
        if (!existing) throw error;
      }
    }
    if (!existing) {
      const legacy = await readKey(db, KEY_ID);
      const owner = await new Promise<string | undefined>((resolve, reject) => {
        const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get("legacy-owner");
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      if (legacy && (!owner || owner === userId)) {
        const remote = await serverKey(userId);
        if (remote && samePublic(remote, legacy.publicKey)) {
          // Claim and copy atomically: two tabs/accounts cannot both adopt it.
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite"); const store = tx.objectStore(STORE_NAME);
            const claim = store.get("legacy-owner");
            claim.onsuccess = () => {
              if (!claim.result || claim.result === userId) { store.put(userId, "legacy-owner"); store.put(legacy, id); }
            };
            tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
          });
          existing = await readKey(db, id);
        }
      }
    }
    if (!existing) {
      const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"]);
      const generated = { publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey), privateKey: pair.privateKey };
      // Compare-and-create inside one IDB transaction (two concurrent tabs).
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite"); const store = tx.objectStore(STORE_NAME);
        const req = store.get(id); req.onsuccess = () => { if (!req.result) store.put(generated, id); };
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
      existing = await readKey(db, id);
    }
    if (!existing) throw new Error("Could not store identity");
    return { publicKeyJwk: existing.publicKey, privateKey: existing.privateKey };
  } finally { db.close(); }
}

/**
 * FIX-E2EEBTN: результат публикации открытого ключа.
 *
 *   published — ключа на аккаунте не было, теперь есть;
 *   already   — на сервере уже лежит ровно этот ключ;
 *   conflict  — на аккаунте ключ с другого устройства. Подменять его нельзя:
 *               вся переписка, зашифрованная для прежнего ключа, станет
 *               нечитаемой. Нужен перенос ключа через «Импорт ключа»;
 *   error     — сеть или сервер не ответили.
 */
export type PublishKeyResult = "published" | "already" | "conflict" | "error";

/**
 * FIX-E2EEBTN: выкладывает открытую часть ключа на сервер, если её там нет.
 *
 * Из-за отсутствия этого шага кнопка защищённого режима и пропадала.
 * getOrCreateKeyPair складывает пару только в IndexedDB своего браузера, а
 * на сервер ключ уходил ровно в одном месте — в importKeysFromJSON, то есть
 * только если человек вручную импортировал резервную копию. У обычного
 * пользователя поле e2eePublicKey в базе оставалось пустым навсегда. А в
 * панели ЛС кнопка показывается лишь когда есть две части: свой закрытый
 * ключ и открытый ключ собеседника — второй всегда приходил пустым, и
 * кнопки не было ни у одной из сторон.
 *
 * Замена чужого ключа здесь не делается сознательно: автоматическая замена
 * при каждом входе с нового браузера тихо уничтожала бы всю старую
 * зашифрованную переписку.
 */
export async function ensurePublicKeyPublished(
  myUserId: string,
  publicKeyJwk: JsonWebKey
): Promise<PublishKeyResult> {
  const x = publicKeyJwk.x;
  const y = publicKeyJwk.y;
  if (typeof x !== "string" || typeof y !== "string") return "error";

  try {
    const current = await fetch(`/api/e2ee?userId=${encodeURIComponent(myUserId)}`, {
      credentials: "include",
    });
    if (current.ok) {
      const data = (await current.json()) as { publicKey?: { x?: string; y?: string } | null };
      const server = data.publicKey;
      if (server) return server.x === x && server.y === y ? "already" : "conflict";
    }

    /* Отправляем ровно четыре поля открытого ключа: сервер отклоняет запись,
       в которой есть хоть что-то лишнее — и правильно делает. */
    const res = await fetch("/api/e2ee", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: { kty: "EC", crv: "P-256", x, y } }),
    });
    if (res.ok) return "published";
    if (res.status === 409) return "conflict";
    return "error";
  } catch {
    return "error";
  }
}

/** Назначение ключа вшито в сам ключ: см. комментарий к deriveSharedKey. */
const KDF_INFO = "trioz-e2ee-v2/aes-256-gcm";

/**
 * Общий ключ пары.
 *
 * FIX-CRYPTO: раньше сырой результат ECDH брался как AES-ключ напрямую. Так
 * делать не принято: в этих битах остаётся структура точки кривой (распределение
 * не равномерное), и у них нет привязки к назначению — один и тот же секрет
 * годился бы для любого другого применения. HKDF с явным info даёт ключ ровно
 * для этой задачи и этой версии формата.
 *
 * `legacy: true` восстанавливает старый ключ — только чтобы прочитать переписку,
 * зашифрованную до этой правки. Шифруется всё новое только по v2.
 */
async function deriveSharedKey(
  privateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey,
  legacy = false
): Promise<CryptoKey> {
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

  if (legacy) {
    return crypto.subtle.importKey(
      "raw",
      sharedBits,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(KDF_INFO),
    },
    hkdfKey,
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

  /* FIX-CRYPTO: в строку добавлена версия вывода ключа. Без неё переход на HKDF
     сделал бы нечитаемой всю ранее отправленную переписку. Префикс `e2ee:`
     не трогаем: по нему весь остальной код узнаёт шифрованное сообщение. */
  return `${E2EE_PREFIX}v2:${ivHex}:${ctHex}`;
}

export async function decryptMessage(
  encrypted: string,
  privateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey
): Promise<string> {
  if (!encrypted.startsWith(E2EE_PREFIX)) return encrypted;

  const data = encrypted.slice(E2EE_PREFIX.length);
  const parts = data.split(":");
  /* Старый формат — две части (iv:ct), новый — три (v2:iv:ct). */
  const legacy = parts.length < 3;
  const ivHex = legacy ? parts[0] : parts[1];
  const ctHex = legacy ? parts[1] : parts[2];
  if (!ivHex || !ctHex) return encrypted;

  const sharedKey = await deriveSharedKey(privateKey, peerPublicKeyJwk, legacy);
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
  const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));

  /* У вложения в отличие от сообщения негде хранить метку версии: в базе лежит
     только iv. Поэтому сначала пробуем новый ключ, потом старый: AES-GCM
     проверяет целостностность сам, и неверный ключ даёт ошибку, а не мусор. */
  try {
    const sharedKey = await deriveSharedKey(privateKey, peerPublicKeyJwk);
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, encrypted);
  } catch {
    const legacyKey = await deriveSharedKey(privateKey, peerPublicKeyJwk, true);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, legacyKey, encrypted);
  }
}

let keyCache = new WeakMap<CryptoKey, Map<string, CryptoKey>>();

export async function getCachedSharedKey(
  privateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey,
  peerId: string
): Promise<CryptoKey> {
  const cacheId = `${peerId}:${peerPublicKeyJwk.crv}:${peerPublicKeyJwk.x}:${peerPublicKeyJwk.y}`;
  const cache = keyCache.get(privateKey) ?? new Map<string, CryptoKey>();
  const cached = cache.get(cacheId);
  if (cached) return cached;

  const key = await deriveSharedKey(privateKey, peerPublicKeyJwk);
  cache.set(cacheId, key);
  keyCache.set(privateKey, cache);
  return key;
}

/* ── Backup / Restore ── */

export async function exportKeysToJSON(userId: string): Promise<string | null> {
  const db = await openDB();
  try {
    const stored = await readKey(db, accountKey(userId));
    if (!stored) return null;
    try {
      const privateKey = await crypto.subtle.exportKey("jwk", stored.privateKey);
      return JSON.stringify({ version: 2, userId, publicKey: stored.publicKey, privateKey });
    } catch {
      throw new Error("Этот ключ неизвлекаемый: экспорт невозможен. Не очищайте данные устройства — без прежнего приватного ключа старая переписка не восстановится. Новый ключ не расшифрует старую историю.");
    }
  } finally { db.close(); }
}

// Web Locks serialize imports and recovery across tabs on supported browsers.
// The queue is a same-tab fallback; server compare-and-set remains authoritative.
const identityQueues = new Map<string, Promise<unknown>>();
async function withIdentityLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const name = `e2ee:${accountKey(userId)}`;
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(name, operation);
  const previous = identityQueues.get(name) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  identityQueues.set(name, next);
  try { return await next; } finally { if (identityQueues.get(name) === next) identityQueues.delete(name); }
}
export async function importKeysFromJSON(json: string, userId: string, confirmReplace = false): Promise<boolean> {
  return withIdentityLock(userId, () => importKeysUnlocked(json, userId, confirmReplace));
}
async function importKeysUnlocked(json: string, userId: string, confirmReplace: boolean): Promise<boolean> {
  const id = accountKey(userId);
  let db: IDBDatabase | null = null;
  try {
    const parsed = JSON.parse(json);
    if (parsed.userId && parsed.userId !== userId) return false;
    const { publicKey, privateKey: privateJwk } = parsed;
    if (!publicKey || !privateJwk || "d" in publicKey || publicKey.crv !== "P-256") return false;
    const importedPrivate = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
    const importedPublic = await crypto.subtle.importKey("jwk", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
    // Validate the actual relation d*G == public point, not just JWK labels.
    const probe = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const a = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: probe.publicKey }, importedPrivate, 256));
    const b = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: importedPublic }, probe.privateKey, 256));
    if (a.some((value, i) => value !== b[i])) return false;
    db = await openDB();
    const next = { publicKey, privateKey: importedPrivate };
    // Preserve the old key and stage the new key BEFORE contacting the server.
    // Failure never overwrites the active key; ambiguous commits are recovered.
    const old = await readKey(db, id);
    if (old) await writeKey(db, `${id}:history:${old.publicKey.x}:${old.publicKey.y}`, old);
    await writeKey(db, `${id}:pending`, next);
    const response = await fetch("/api/e2ee", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey, confirmReplace }),
    });
    if (!response.ok) return false;
    await writeKey(db, id, next);
    keyCache = new WeakMap();
    return true;
  } catch { return false; }
  finally { db?.close(); }
}
