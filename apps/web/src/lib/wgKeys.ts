/**
 * VPN-AUTOKEY: генерация пары ключей WireGuard на устройстве пользователя.
 *
 * Зачем свой X25519, а не WebCrypto: `crypto.subtle` умеет X25519 только с
 * Chromium 133, а десктоп-оболочка проекта собрана на Electron 33 (Chromium
 * 130) — то есть ровно там, где VPN нужнее всего, WebCrypto бы не сработал.
 * Один проверенный путь надёжнее двух с молчаливым отвалом на половине
 * клиентов.
 *
 * Реализация — лестница Монтгомери из RFC 7748 §5 на BigInt. Она проверена
 * контрольными векторами RFC 7748 §6.1 и сверена с X25519 самого Node на
 * случайных ключах.
 *
 * Про постоянное время выполнения: этой реализации оно не гарантировано, и это
 * осознанно. Утечка по времени опасна там, где скаляр умножается на данные,
 * пришедшие от атакующего; здесь же ключ рождается из системного CSPRNG прямо
 * на устройстве владельца и умножается на фиксированную базовую точку. Мерить
 * тут нечего и некому.
 *
 * Приватная половина остаётся в памяти страницы. На сервер уходит только
 * публичная — контракт «приватного ключа на сервере не существует» не меняется.
 *
 * Числа собраны через `BigInt(...)`, а не литералами вида `1n`, потому что
 * `tsconfig` этого пакета собирается с `target: ES2017`, где литералы BigInt
 * запрещены (компилятор не может их понизить). Поднимать target всему
 * монорепозиторию из-за одного файла — несоразмерная правка: на выполнение это
 * не влияет никак, BigInt есть во всех браузерах с 2018 года.
 */

const ZERO = BigInt(0);
const ONE = BigInt(1);
const BYTE_MASK = BigInt(255);
const BITS_PER_BYTE = BigInt(8);
const P = (ONE << BigInt(255)) - BigInt(19);
const A24 = BigInt(121665);

function mod(n: bigint): bigint {
  const r = n % P;
  return r >= ZERO ? r : r + P;
}

/** Обратный элемент через малую теорему Фермá: z^(p-2) mod p. */
function invert(z: bigint): bigint {
  let result = ONE;
  let base = mod(z);
  let exp = P - BigInt(2);
  while (exp > ZERO) {
    if (exp & ONE) result = mod(result * base);
    base = mod(base * base);
    exp >>= ONE;
  }
  return result;
}

function decodeLE(bytes: Uint8Array): bigint {
  let n = ZERO;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << BITS_PER_BYTE) | BigInt(bytes[i]);
  return n;
}

function encodeLE(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & BYTE_MASK);
    v >>= BITS_PER_BYTE;
  }
  return out;
}

/**
 * Обрезка скаляра по RFC 7748. `wg genkey` делает то же самое, поэтому приватный
 * ключ сохраняем уже обрезанным: иначе base64 отличался бы от того, что показал
 * бы сам WireGuard, хотя публичный ключ выходил бы одинаковый.
 */
function clamp(scalar: Uint8Array): Uint8Array {
  const k = Uint8Array.from(scalar);
  k[0] &= 248;
  k[31] &= 127;
  k[31] |= 64;
  return k;
}

/** X25519: умножение точки u на скаляр. RFC 7748 §5. */
function x25519(scalar: Uint8Array, uCoordinate: Uint8Array): Uint8Array {
  const k = decodeLE(clamp(scalar));
  const u = Uint8Array.from(uCoordinate);
  u[31] &= 127;
  const x1 = mod(decodeLE(u));

  let x2 = ONE;
  let z2 = ZERO;
  let x3 = x1;
  let z3 = ONE;
  let swap = ZERO;

  for (let t = 254; t >= 0; t--) {
    const bit = (k >> BigInt(t)) & ONE;
    swap ^= bit;
    if (swap === ONE) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = bit;

    const a = mod(x2 + z2);
    const aa = mod(a * a);
    const b = mod(x2 - z2);
    const bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = mod(d * a);
    const cb = mod(c * b);
    x3 = mod((da + cb) * (da + cb));
    z3 = mod(x1 * mod((da - cb) * (da - cb)));
    x2 = mod(aa * bb);
    z2 = mod(e * mod(aa + mod(A24 * e)));
  }

  if (swap === ONE) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }

  return encodeLE(mod(x2 * invert(z2)));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface WireGuardKeyPair {
  /** base64, 44 символа. Существует только в памяти страницы. */
  privateKey: string;
  /** base64, 44 символа. Уходит на сервер. */
  publicKey: string;
}

/**
 * Новая пара ключей WireGuard. Работает только в браузере: источник случайности
 * — `crypto.getRandomValues`, подменять его на что-то «переносимое» нельзя.
 */
export function generateWireGuardKeyPair(): WireGuardKeyPair {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Нет доступа к системному источнику случайности");
  }
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const priv = clamp(random);
  const base = new Uint8Array(32);
  base[0] = 9; // базовая точка Curve25519
  const pub = x25519(priv, base);
  return { privateKey: toBase64(priv), publicKey: toBase64(pub) };
}

/**
 * Порядок дополнительных параметров интерфейса. На разбор он не влияет, но
 * профиль читают люди, и привычный порядок читается быстрее произвольного.
 */
const EXTRA_ORDER = [
  "Jc", "Jmin", "Jmax",
  "S1", "S2", "S3", "S4",
  "H1", "H2", "H3", "H4",
  "I1", "I2", "I3", "I4", "I5",
];

/**
 * Ключ WireGuard — 32 байта в base64: ровно 43 символа алфавита и одно «=».
 * Другой длины у корректного ключа не бывает.
 */
const WG_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Проверка ключа перед сборкой профиля.
 *
 * Раньше значения подставлялись в текст без проверки, и мусор молча уезжал в
 * готовый файл. Ошибку человек видел не у нас, а в клиенте WireGuard при
 * импорте профиля — то есть далеко от места, где она возникла, и без намёка,
 * какое из полей испорчено.
 *
 * В сообщение попадает длина, но НЕ само значение: сюда приходит и приватный
 * ключ, а текст ошибки имеет привычку оказываться в журналах и отчётах о сбоях.
 */
function assertWireGuardKey(value: unknown, label: string): void {
  if (typeof value === "string" && WG_KEY_RE.test(value)) return;
  const got = typeof value === "string" ? `строку длиной ${value.length}` : `значение типа ${typeof value}`;
  throw new Error(`${label}: ожидается ключ WireGuard в base64 (44 символа), получено ${got}`);
}

/**
 * Готовый профиль. Приватный ключ подставляется здесь же, на клиенте.
 *
 * `extra` — дополнительные параметры интерфейса узла, если узел их требует.
 * Они одинаковы для всех клиентов этого узла и приходят с сервера в готовом
 * виде: клиент их не придумывает и не проверяет, его дело — вписать.
 */
export function buildWireGuardConfig(params: {
  privateKey: string;
  address: string;
  dns: string;
  serverPublicKey: string;
  endpoint: string;
  allowedIps: string;
  extra?: Record<string, string | number> | null;
}): string {
  assertWireGuardKey(params.privateKey, "PrivateKey");
  assertWireGuardKey(params.serverPublicKey, "PublicKey узла");

  const extraLines = params.extra
    ? EXTRA_ORDER.filter((key) => params.extra?.[key] !== undefined).map((key) => `${key} = ${params.extra?.[key]}`)
    : [];

  return [
    "[Interface]",
    ...extraLines,
    `PrivateKey = ${params.privateKey}`,
    `Address = ${params.address}/32`,
    `DNS = ${params.dns}`,
    "",
    "[Peer]",
    `PublicKey = ${params.serverPublicKey}`,
    `Endpoint = ${params.endpoint}`,
    `AllowedIPs = ${params.allowedIps}`,
    "PersistentKeepalive = 25",
    "",
  ].join("\n");
}
