"use client";

/**
 * FIX-KEYSTICK: ключ VPN закрепляется за устройством.
 *
 * Что было. Пара ключей создавалась заново на КАЖДОЕ включение туннеля и на
 * каждое обращение к «Настроить»: `generateWireGuardKeyPair()` вызывался прямо
 * в обработчике. Публичный ключ уезжал на сервер, запись пира
 * перезаписывалась (`POST /api/vpn/me` делает upsert по пользователю), и агент
 * на узле в следующий цикл ставил новый ключ, а прежний УДАЛЯЛ.
 *
 * Чем это кончалось на живом узле:
 *
 *   [vpn-agent] пиры обновлены: +1 / -1, всего 1
 *
 * Такая строка каждые несколько минут означает, что ключ работающего прямо
 * сейчас соединения снесён. WireGuard на неизвестный ключ не отвечает ВООБЩЕ:
 * ни ошибки, ни отказа — трафик просто перестаёт ходить. Пользователь видит
 * либо «подключено, но интернета нет», либо, при следующей попытке, «узел не
 * ответил на рукопожатие», потому что ждёт ответ по ключу, который на узле уже
 * заменён. Проверялось на узле: за 7 минут ключ пира сменился дважды, а
 * счётчики остались на 180 B / 92 B — то есть рукопожатие прошло, а полезного
 * трафика не было.
 *
 * Как сейчас. Пара создаётся ОДИН раз и живёт в локальном хранилище устройства.
 * Повторное включение отдаёт серверу тот же публичный ключ: `peerChanges`
 * (apps/vpn/src/rules.mjs) видит совпадение ключа и разрешённых адресов и не
 * делает ничего — ни `+1`, ни `-1`.
 *
 * Почему localStorage, а не файл в оболочке: приватный ключ и так не должен
 * покидать устройство, а localStorage окна Electron — это файл в профиле
 * приложения на той же машине. Через IPC ключ пришлось бы гонять между
 * процессами, то есть расширять поверхность, ничего не выигрывая.
 *
 * Хранилища может не быть (приватный режим, отключённые данные сайтов). Тогда
 * работает прежнее поведение — разовая пара в памяти. Это хуже, но не ломает
 * включение.
 */

import { generateWireGuardKeyPair, type WireGuardKeyPair } from "@/lib/wgKeys";

/** Имя записи в локальном хранилище. Менять нельзя: сменится — сменится ключ. */
export const DEVICE_KEY_STORAGE = "trioz.vpn.deviceKey";

/** Ключ WireGuard: 32 байта в base64 — 43 символа алфавита и одно «=». */
const WG_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Разбор сохранённой пары.
 *
 * Проверяются ОБА ключа, а не наличие полей: в хранилище могла остаться запись
 * от прежней версии, обрезанная строка или чужой мусор по тому же имени. Порча
 * ключа проявилась бы далеко от места, где возникла, — молчащим туннелем.
 */
export function parseStoredKeyPair(raw: string | null | undefined): WireGuardKeyPair | null {
  if (typeof raw !== "string" || !raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { privateKey, publicKey } = value as Record<string, unknown>;
  if (typeof privateKey !== "string" || !WG_KEY_RE.test(privateKey)) return null;
  if (typeof publicKey !== "string" || !WG_KEY_RE.test(publicKey)) return null;
  return { privateKey, publicKey };
}

/** Запись пары в строку хранилища. */
export function serializeKeyPair(pair: WireGuardKeyPair): string {
  return JSON.stringify({ privateKey: pair.privateKey, publicKey: pair.publicKey });
}

/**
 * Чистая часть решения — она же единственная, которую есть смысл проверять
 * тестом: браузерное хранилище в тест не втащить, а правило «есть годная
 * запись — берём её, иначе создаём новую» проверить нужно.
 */
export function pickKeyPair(
  stored: string | null | undefined,
  create: () => WireGuardKeyPair,
): { pair: WireGuardKeyPair; created: boolean } {
  const existing = parseStoredKeyPair(stored);
  if (existing) return { pair: existing, created: false };
  return { pair: create(), created: true };
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    /* приватный режим или запрещённые данные сайтов */
    return null;
  }
}

/**
 * Пара ключей этого устройства. Одна и та же при каждом вызове.
 *
 * Возвращаемое значение содержит приватный ключ, поэтому его нельзя класть ни
 * в состояние React, ни в журналы: только собрать профиль и отдать оболочке.
 */
export function deviceKeyPair(): WireGuardKeyPair {
  const store = storage();
  const { pair, created } = pickKeyPair(store?.getItem(DEVICE_KEY_STORAGE) ?? null, generateWireGuardKeyPair);
  if (created && store) {
    try {
      store.setItem(DEVICE_KEY_STORAGE, serializeKeyPair(pair));
    } catch {
      /* хранилище переполнено — ключ проживёт до перезагрузки окна */
    }
  }
  return pair;
}

/**
 * Забыть ключ устройства. Вызывается при полном отзыве доступа: запись пира на
 * сервере удаляется, и держать ключ, которого больше нет на узле, незачем —
 * следующее подключение честно начнётся с новой пары.
 */
export function forgetDeviceKeyPair(): void {
  try {
    storage()?.removeItem(DEVICE_KEY_STORAGE);
  } catch {
    /* нечего забывать */
  }
}
