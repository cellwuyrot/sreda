/**
 * Настройки уведомлений аккаунта на стороне клиента.
 *
 * «Звуковые уведомления» и «Push-уведомления» из настроек хранились в базе и
 * возвращались API, но клиент их не читал вовсе: звук играл всегда, а системные
 * уведомления о сообщениях в каналах уходили независимо от выключенного пуша.
 * Галочки сохранялись — и не значили ничего.
 *
 * Читать их из базы в момент прихода сообщения нельзя: решение о звуке
 * принимается в обработчике сокета, где сетевого похода быть не должно. Поэтому
 * значения загружаются один раз и лежат в localStorage, а страница настроек
 * обновляет их сразу при сохранении — через то же событие, которое она уже
 * отправляла (слушателей у него до сих пор не было).
 */

export interface NotifyPrefs {
  /** Звук при новом сообщении и упоминании. */
  notifySound: boolean;
  /** Системные уведомления «снаружи приложения». */
  notifyPush: boolean;
}

export const NOTIFY_PREFS_DEFAULT: NotifyPrefs = { notifySound: true, notifyPush: true };

/** Событие о смене настроек в этой же вкладке. */
export const NOTIFY_PREFS_EVENT = "tz-notify-settings";

const STORAGE_KEY = "tz-notify-prefs";

/* Значение держим в памяти: к нему обращается обработчик сокета на каждое
   сообщение, а чтение localStorage синхронно бьёт по главному потоку. */
let cache: NotifyPrefs | null = null;
let loaded = false;

function normalize(raw: unknown): NotifyPrefs {
  if (!raw || typeof raw !== "object") return { ...NOTIFY_PREFS_DEFAULT };
  const input = raw as Partial<Record<keyof NotifyPrefs, unknown>>;
  return {
    notifySound: input.notifySound !== false,
    notifyPush: input.notifyPush !== false,
  };
}

function readStorage(): NotifyPrefs {
  if (typeof window === "undefined") return { ...NOTIFY_PREFS_DEFAULT };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : { ...NOTIFY_PREFS_DEFAULT };
  } catch {
    return { ...NOTIFY_PREFS_DEFAULT };
  }
}

/** Текущие настройки без похода в сеть. */
export function getNotifyPrefs(): NotifyPrefs {
  if (!cache) cache = readStorage();
  return cache;
}

/** Запомнить настройки и сообщить о смене всем, кто их читает. */
export function cacheNotifyPrefs(prefs: Partial<NotifyPrefs>): NotifyPrefs {
  const next = normalize({ ...getNotifyPrefs(), ...prefs });
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* приватный режим — значение уже в памяти */
    }
    window.dispatchEvent(new CustomEvent<NotifyPrefs>(NOTIFY_PREFS_EVENT, { detail: next }));
  }
  return next;
}

/**
 * Подтянуть настройки с сервера. Достаточно одного раза за загрузку страницы:
 * дальше их правит только сам пользователь, и правки приходят событием.
 */
export async function loadNotifyPrefs(force = false): Promise<NotifyPrefs> {
  if (loaded && !force) return getNotifyPrefs();
  loaded = true;
  try {
    const res = await fetch("/api/profile/notifications");
    if (!res.ok) return getNotifyPrefs();
    const data = (await res.json()) as Partial<NotifyPrefs>;
    return cacheNotifyPrefs(data);
  } catch {
    /* Оффлайн или нет сессии — остаёмся на прошлом значении. */
    return getNotifyPrefs();
  }
}

/** Можно ли играть звук уведомления. */
export function notifySoundAllowed(): boolean {
  return getNotifyPrefs().notifySound;
}

/** Можно ли показывать системное уведомление. */
export function notifyPushAllowed(): boolean {
  return getNotifyPrefs().notifyPush;
}
