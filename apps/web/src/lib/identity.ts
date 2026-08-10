import prisma from "./prisma";

/**
 * НОВОЕ: остановка учётной записи по IP и устройству (MAC).
 *
 * Браузер не имеет доступа к MAC-адресу, поэтому:
 *  - десктоп-клиент присылает стабильный ID устройства — SHA-256-хэш
 *    MAC-адресов сетевых интерфейсов (см. apps/desktop, GET_DEVICE_ID);
 *  - обычный браузер использует случайный постоянный ID из localStorage.
 * Оба варианта попадают в cookie `tz-device` и в POST /api/device.
 *
 * IP хранится только как диагностическая история. Блокировка привязана к
 * стабильному ID устройства: IP меняется при VPN/роуминге и не может быть
 * идентификатором аккаунта (к тому же один VPN-IP разделяют многие люди).
 */

export const DEVICE_COOKIE = "tz-device";

type HeaderBag = Headers | Record<string, unknown> | null | undefined;

/** Значение заголовка из Headers или простого объекта (NextAuth передаёт объект). */
export function headerValue(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const rec = headers as Record<string, unknown>;
  const lower = name.toLowerCase();
  /* Имена заголовков регистр не различают (RFC 9110 §5.1), а простой объект —
     различает. Прямое попадание и нижний регистр закрывают обычные случаи: и
     Node, и Next отдают имена строчными. Перебор нужен для словаря, собранного
     руками, где ключ может оказаться видом «X-User-Id»: раньше такой заголовок
     просто терялся, а это модуль блокировок — терять здесь нечего. */
  let v = rec[name] ?? rec[lower];
  if (v === undefined || v === null) {
    for (const key of Object.keys(rec)) {
      if (key.toLowerCase() === lower) {
        v = rec[key];
        break;
      }
    }
  }
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : null;
  return typeof v === "string" ? v : null;
}

/** Значение одной cookie из сырого заголовка Cookie. */
export function cookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("=")) || null;
      } catch {
        return rest.join("=") || null;
      }
    }
  }
  return null;
}

/** IP клиента из запроса (за прокси — первый адрес из x-forwarded-for). */
export function getClientIp(req: { headers: Headers }): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip");
}

function normalize(kind: "IP" | "DEVICE", value: string | null | undefined): string | null {
  const v = (value || "").trim();
  if (!v || v.length > 128) return null;
  // Локальные адреса не блокируем — иначе один бан остановит всех за тем же прокси.
  if (kind === "IP" && (v === "127.0.0.1" || v === "::1" || v === "unknown")) return null;
  return v;
}

/** Запомнить текущие IP/устройство пользователя (best-effort, не ломает основной поток). */
export async function recordIdentities(userId: string, ip?: string | null, deviceId?: string | null): Promise<void> {
  const entries: Array<{ kind: string; value: string }> = [];
  const nip = normalize("IP", ip);
  const ndev = normalize("DEVICE", deviceId);
  if (nip) entries.push({ kind: "IP", value: nip });
  if (ndev) entries.push({ kind: "DEVICE", value: ndev });
  for (const e of entries) {
    try {
      await prisma.userIdentity.upsert({
        where: { userId_kind_value: { userId, kind: e.kind, value: e.value } },
        create: { userId, kind: e.kind, value: e.value },
        update: { lastSeen: new Date() },
      });
    } catch {
      /* таблица может отсутствовать до применения миграции */
    }
  }
}

/** Заблокированы ли текущие IP/устройство. */
export async function isIdentityBlocked(_ip?: string | null, deviceId?: string | null): Promise<boolean> {
  const or: Array<{ kind: string; value: string }> = [];
  const ndev = normalize("DEVICE", deviceId);
  if (ndev) or.push({ kind: "DEVICE", value: ndev });
  if (or.length === 0) return false;
  try {
    const hit = await prisma.blockedIdentity.findFirst({ where: { OR: or }, select: { id: true } });
    return hit !== null;
  } catch {
    return false;
  }
}

/** При глобальном бане: блокировать стабильные устройства, но никогда IP. */
export async function blockUserIdentities(userId: string, reason?: string | null): Promise<void> {
  try {
    // Remove old IP blocks created by previous versions so changing VPN or
    // receiving a recycled provider IP cannot freeze an unrelated client.
    await prisma.blockedIdentity.deleteMany({ where: { userId, kind: "IP" } });
    const identities = await prisma.userIdentity.findMany({ where: { userId, kind: "DEVICE" } });
    for (const ident of identities) {
      await prisma.blockedIdentity.upsert({
        where: { kind_value: { kind: ident.kind, value: ident.value } },
        create: { kind: ident.kind, value: ident.value, userId, reason: reason || null },
        update: { userId, reason: reason || null },
      });
    }
  } catch {
    /* best-effort */
  }
}

/** При разбане: снять блокировки, созданные из-за этого пользователя. */
export async function unblockUserIdentities(userId: string): Promise<void> {
  try {
    await prisma.blockedIdentity.deleteMany({ where: { userId } });
  } catch {
    /* best-effort */
  }
}
