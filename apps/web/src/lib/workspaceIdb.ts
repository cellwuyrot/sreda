/**
 * WS-IDB: IndexedDB кэш для состояния рабочей среды.
 *
 * Причина замены localStorage: localStorage.setItem — синхронный вызов,
 * который блокирует главный поток. Для большого workspace (10к+ ячеек
 * в таблице) JSON может достигать нескольких МБ, что даёт заметную
 * подвиску при каждом нажатии клавиши / перетащивании карточки.
 *
 * IndexedDB асинхронный: запись не задерживает отрисовку. При недоступности
 * — фоллбэк на localStorage.
 */

const DB_NAME = "tz-workspace-cache";
const DB_VERSION = 1;
const STORE_NAME = "state";

let _db: IDBDatabase | null = null;
let _dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (_db) return Promise.resolve(_db);
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => {
        _db = req.result;
        resolve(_db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return _dbPromise;
}

/**
 * Записать значение в IDB. При ошибке — фоллбэк на localStorage.
 */
export async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    try { localStorage.setItem(key, value); } catch { /* quota */ }
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    try { localStorage.setItem(key, value); } catch { /* quota */ }
  }
}

/**
 * Прочитать значение из IDB. При ошибке / отсутствии — фоллбэк на localStorage.
 */
export async function idbGet(key: string): Promise<string | null> {
  const db = await openDb();
  if (!db) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  try {
    const result = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
      req.onerror = () => reject(req.error);
    });
    // Если в IDB пусто, пробуем localStorage как запасной вариант
    if (!result) {
      try { return localStorage.getItem(key); } catch { /* ignore */ }
    }
    return result;
  } catch {
    try { return localStorage.getItem(key); } catch { return null; }
  }
}

/**
 * Удалить значение из IDB.
 */
export async function idbRemove(key: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}
