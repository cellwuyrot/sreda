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
    /* FIX-CRYPTO: здесь раньше СОЗДАВАЛАСЬ новая пара ключей и тихо
       отправлялась на сервер — попытка СОХРАНИТЬ ключ НАВСЕГДА УНИЧТОЖАЛА
       всю ранее зашифрованную переписку (старый приватный ключ стирался,
       и читать старые сообщения больше было нечем). Ключ, созданный
       неизвлекаемым, выгрузить нельзя — и это надо честно сказать, а не
       подменять молча. */
    throw new Error(
      "Ключ этого устройства создан неизвлекаемым: резервная копия невозможна. " +
        "Создайте новый ключ на втором устройстве и перенесите его через «Импорт ключа»: " +
        "так старая переписка останется читаемой."
    );
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

    /* FIX-BUG: публичный ключ уходил СТРОКОЙ (двойной JSON.stringify), а сервер
       ждёт объект — запрос всегда отклонялся с «Invalid public key», и после
       переноса ключа собеседник шифровал на старый. Ошибка глоталась тихо. */
    const res = await fetch("/api/e2ee", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey, confirmReplace: true }),
    });
    if (!res.ok) return false;

    keyCache.clear();
    return true;
  } catch {
    return false;
  }
}
