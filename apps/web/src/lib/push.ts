import { createSign } from "node:crypto";
import prisma from "@/lib/prisma";

/**
 * PUSH: доставка уведомления в ЗАКРЫТОЕ приложение на телефоне.
 *
 * ── Что было сломано ────────────────────────────────────────────────────────
 *
 * Уведомления показывались только пока приложение открыто. Живое соединение
 * есть — значит и уведомление есть; приложение свернули и система его выгрузила —
 * и мессенджер молчал до следующего запуска. Для мессенджера это не мелкая
 * недоделка, а отсутствие главного: человек узнаёт о сообщении, только если сам
 * решит его поискать.
 *
 * ── Почему через службу доставки телефона ───────────────────────────────────
 *
 * Своим соединением этого не решить: закрытое приложение не держит сокет, а
 * держать его в фоне — значит вечно висеть в шторке и жечь батарею, и всё равно
 * быть выгруженным системой. Единственный путь, который работает у всех
 * мессенджеров, — отдать сообщение службе доставки, которая живёт в самой ОС.
 *
 * ── Что уходит и чего НЕ уходит ─────────────────────────────────────────────
 *
 * Уходит только то, что и так показывается в шторке: заголовок, короткая
 * выжимка и куда открыть. Ни содержимого переписки целиком, ни вложений, ни
 * идентификаторов чужих людей. Сообщение уходит БЕЗ готового блока уведомления:
 * решение «показывать или нет» принимает оболочка на устройстве — иначе человек с
 * открытым приложением получал бы всё дважды (живым соединением и от системы).
 *
 * ── Настройка ───────────────────────────────────────────────────────────────
 *
 * Доступы задаются переменными окружения на сервере (см. docs/server-actions.md).
 * Не задано — отправка молча пропускается: сервис работает как раньше, ничего не
 * падает. Это важнее удобства: отсутствие доступа к чужой службе не должно
 * ломать ни отправку сообщения, ни создание уведомления.
 */

/** Куда уходит сообщение: заголовок, выжимка, адрес открытия. */
export interface PushMessage {
  title: string;
  body?: string;
  /** Путь внутри приложения, например /connect?section=dm&dm=... */
  link?: string;
  /** Метка, по которой уведомления одной беседы схлопываются в одно. */
  tag?: string;
}

interface PushConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Ограничение на один заход: больше на одного человека и не бывает. */
const MAX_DEVICES_PER_SEND = 50;

/**
 * Доступы из окружения.
 *
 * Приватный ключ в переменной окружения хранится с экранированными переводами
 * строк — так его вообще возможно положить в .env одной строкой. Возвращаем
 * его к нормальному виду здесь, а не заставляем помнить об этом каждого, кто
 * будет настраивать сервер.
 */
export function pushConfig(): PushConfig | null {
  const projectId = process.env.FCM_PROJECT_ID?.trim();
  const clientEmail = process.env.FCM_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

/** Настроена ли доставка. Панель и маршруты по этому признаку честно молчат. */
export function pushConfigured(): boolean {
  return pushConfig() !== null;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Подписанное утверждение о том, кто мы. Служба доставки в обмен на него выдаёт
 * короткоживущий пропуск.
 */
export function buildAssertion(config: PushConfig, now: number = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${base64url(signer.sign(config.privateKey))}`;
}

/** Пропуск живёт час; держим его в памяти процесса и берём заново заранее. */
let cachedToken: { value: string; expiresAt: number } | null = null;

export function resetPushTokenCache(): void {
  cachedToken = null;
}

async function accessToken(config: PushConfig): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(config),
    }),
  });
  if (!res.ok) {
    console.warn("[push] служба доставки не выдала пропуск:", res.status);
    return null;
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

/**
 * Тело сообщения для одного устройства.
 *
 * Все значения — строки: служба доставки принимает только их. Готового блока
 * уведомления здесь нет намеренно (см. заголовок файла): показывать решает
 * оболочка, иначе при открытом приложении человек получит уведомление дважды.
 */
export function buildPushPayload(token: string, message: PushMessage) {
  return {
    message: {
      token,
      data: {
        title: message.title.slice(0, 120),
        body: (message.body ?? "").slice(0, 240),
        link: message.link ?? "",
        tag: message.tag ?? "",
      },
      android: {
        /* Высокий приоритет: иначе в режиме энергосбережения сообщение может
           ждать «удобного случая» — для переписки это бессмысленно. */
        priority: "HIGH",
        ttl: "86400s",
      },
    },
  };
}

/** Мёртвый адрес: устройство переустановили, приложение снесли, токен сменился. */
function isDeadToken(status: number, payload: unknown): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  const text = JSON.stringify(payload ?? "");
  return text.includes("UNREGISTERED") || text.includes("INVALID_ARGUMENT");
}

/**
 * Отправить уведомление на устройства перечисленных людей.
 *
 * Кому не отправляем: тем, кто выключил уведомления в настройках аккаунта. Эта
 * проверка стоит ЗДЕСЬ, у самой отправки, а не у каждого вызывающего: выключатель
 * должен работать на всех путях, а не на тех, где о нём вспомнили.
 *
 * Возвращает, сколько устройств получили сообщение и сколько мёртвых адресов
 * убрали. Ошибки не бросает: уведомление в колокольчике уже создано, и ронять
 * его из-за чужой службы нельзя.
 */
export async function sendPushToUsers(userIds: string[], message: PushMessage): Promise<{
  sent: number;
  removed: number;
  skipped: boolean;
}> {
  const unique = Array.from(new Set(userIds)).filter(Boolean);
  if (unique.length === 0) return { sent: 0, removed: 0, skipped: true };

  const config = pushConfig();
  if (!config) return { sent: 0, removed: 0, skipped: true };

  const devices = await prisma.pushDevice.findMany({
    where: { userId: { in: unique }, user: { notifyPush: true } },
    select: { id: true, token: true },
    take: MAX_DEVICES_PER_SEND,
  });
  if (devices.length === 0) return { sent: 0, removed: 0, skipped: false };

  const pass = await accessToken(config);
  if (!pass) return { sent: 0, removed: 0, skipped: true };

  const endpoint = `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`;
  let sent = 0;
  const dead: string[] = [];

  for (const device of devices) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${pass}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildPushPayload(device.token, message)),
      });
      if (res.ok) {
        sent += 1;
        continue;
      }
      const payload = await res.json().catch(() => null);
      if (isDeadToken(res.status, payload)) dead.push(device.id);
      else console.warn("[push] устройство не приняло сообщение:", res.status);
    } catch (err) {
      console.warn("[push] сеть недоступна при отправке", err);
    }
  }

  /* Мёртвые адреса убираем сразу. Иначе они накапливаются и каждая рассылка
     тратит время на заведомо неудачные попытки. */
  if (dead.length > 0) {
    await prisma.pushDevice.deleteMany({ where: { id: { in: dead } } }).catch(() => null);
  }

  return { sent, removed: dead.length, skipped: false };
}

/**
 * Отправка «в фон»: вызывающий не ждёт чужую службу.
 *
 * Уведомление в колокольчике создаётся мгновенно, а доставка на устройство может
 * занять секунды. Человек, отправивший сообщение, не должен смотреть на
 * крутящуюся кнопку, пока чужой сервис думает.
 */
export function queuePush(userIds: string[], message: PushMessage): void {
  void sendPushToUsers(userIds, message).catch((err) => console.warn("[push] не удалось отправить", err));
}
