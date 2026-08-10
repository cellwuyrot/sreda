/**
 * STORAGE-PRIORITY: разговор с объектным хранилищем узла.
 *
 * Минимальный клиент S3-совместимого хранилища: положить, забрать, удалить,
 * спросить размер. Ровно четыре действия — больше от узла ничего не нужно.
 *
 * Почему без готовой библиотеки. Официальный набор пакетов для этого протокола
 * тянет за собой несколько десятков зависимостей ради вещей, которых здесь нет:
 * составная загрузка, потоковая подпись, ускорение передачи, обход регионов.
 * Нам нужен один запрос с подписью — а это сорок строк на стандартной криптографии
 * и fetch. Меньше кода, который надо обновлять из-за чужих уязвимостей.
 *
 * Адресация путём (`https://узел/корзина/ключ`), а не поддоменом: у собственной
 * машины обычно один сертификат на имя, и поддомены под каждую корзину означали
 * бы отдельный сертификат и отдельную запись в DNS на ровном месте.
 *
 * Ошибки здесь НЕ глушатся: вызывающий обязан знать, что файл не лёг. Решение
 * «оставить на главном сервере» принимается выше (uploadOffload.ts), и принять
 * его можно, только увидев ошибку.
 */

import { createHash, createHmac } from "crypto";

export interface StorageTarget {
  endpoint: string;
  bucket: string;
  region: string;
  keyId: string;
  secret: string;
}

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
/** Дольше ждать нечего: узел либо рядом, либо его нет. */
const DEFAULT_TIMEOUT_MS = 20_000;

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * Кодирование по правилам подписи, а не по правилам ссылок.
 *
 * `encodeURIComponent` оставляет `!'()*` как есть, а подпись требует их
 * закодированными — иначе хранилище посчитает подпись по другой строке и вернёт
 * отказ. Ловится это только на файлах со скобками в имени, поэтому лучше сразу.
 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Путь в ссылке: слэши между сегментами остаются слэшами. */
function encodeKeyPath(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

/** Время в двух видах, как того требует подпись: 20260101T120000Z и 20260101. */
export function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Подписанный запрос к объекту.
 *
 * Отделено от отправки намеренно: подпись — это чистое преобразование, и
 * проверять её нужно сравнением строк, а не попаданием в живое хранилище.
 */
export function signObjectRequest(params: {
  target: StorageTarget;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  key: string;
  payload?: Buffer;
  extraHeaders?: Record<string, string>;
  now?: Date;
}): SignedRequest {
  const { target, method, key } = params;
  const now = params.now ?? new Date();
  const { amzDate, dateStamp } = amzDates(now);

  const base = new URL(target.endpoint);
  const basePath = base.pathname.replace(/\/+$/, "");
  const canonicalUri = `${basePath}/${uriEncode(target.bucket)}/${encodeKeyPath(key)}`;
  const url = `${base.origin}${canonicalUri}`;

  /* Тело подписывается целиком. Для чтения и удаления тела нет — тогда
     подписывается хеш пустой строки, это часть протокола, а не заглушка. */
  const payloadHash = sha256Hex(params.payload ?? "");

  const headers: Record<string, string> = {
    host: base.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(params.extraHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  };

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${headers[name]!.trim()}\n`).join("");
  const signedHeaders = sortedNames.join(";");

  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${target.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${target.secret}`, dateStamp), target.region), SERVICE), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    url,
    headers: {
      ...headers,
      Authorization: `${ALGORITHM} Credential=${target.keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export class ObjectStoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ObjectStoreError";
  }
}

async function send(signed: SignedRequest, method: string, body?: Buffer, timeoutMs = DEFAULT_TIMEOUT_MS) {
  /* Собственный срок ожидания: без него зависший узел держал бы запрос
     человека столько, сколько решит операционная система. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body as unknown as BodyInit | undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Положить объект. Возвращает управление только после подтверждения узла. */
export async function putObject(
  target: StorageTarget,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const signed = signObjectRequest({
    target,
    method: "PUT",
    key,
    payload: body,
    extraHeaders: { "content-type": contentType, "content-length": String(body.length) },
  });
  const res = await send(signed, "PUT", body);
  if (!res.ok) {
    throw new ObjectStoreError(`запись в хранилище отклонена (${res.status})`, res.status);
  }
}

/**
 * Забрать объект.
 *
 * `range` — заголовок HTTP как есть, строкой, без разбора. Разбирать его здесь
 * было бы лишней работой с шансом ошибиться: форма «последние N байт» требует
 * знать размер, а хранилище его знает и так. Пересылаем дословно и возвращаем
 * ответ вместе с его 206 и Content-Range — перемотка внутри голосового
 * сообщения работает с узла ровно так же, как с диска.
 */
export async function getObject(target: StorageTarget, key: string, range?: string): Promise<Response> {
  const signed = signObjectRequest({
    target,
    method: "GET",
    key,
    extraHeaders: range ? { range } : undefined,
  });
  const res = await send(signed, "GET");
  if (!res.ok && res.status !== 206) {
    throw new ObjectStoreError(`чтение из хранилища не удалось (${res.status})`, res.status);
  }
  return res;
}

/** Размер объекта или null, если его там нет. */
export async function headObject(target: StorageTarget, key: string): Promise<number | null> {
  const signed = signObjectRequest({ target, method: "HEAD", key });
  const res = await send(signed, "HEAD");
  if (res.status === 404) return null;
  if (!res.ok) throw new ObjectStoreError(`опрос хранилища не удался (${res.status})`, res.status);
  const length = res.headers.get("content-length");
  return length ? Number(length) : 0;
}

/** Удалить объект. Отсутствие объекта ошибкой не считается. */
export async function deleteObject(target: StorageTarget, key: string): Promise<void> {
  const signed = signObjectRequest({ target, method: "DELETE", key });
  const res = await send(signed, "DELETE");
  if (!res.ok && res.status !== 404) {
    throw new ObjectStoreError(`удаление из хранилища не удалось (${res.status})`, res.status);
  }
}
