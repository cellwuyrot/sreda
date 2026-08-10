/**
 * Тесты: src/lib/push.ts — доставка уведомлений в ЗАКРЫТОЕ приложение.
 *
 * Зачем это появилось: уведомления показывались только пока приложение открыто.
 * Живое соединение есть — есть уведомление; приложение свернули и система его
 * выгрузила — и мессенджер молчал до следующего запуска.
 *
 * Что проверяется здесь и что легко испортить: выключатель уведомлений должен
 * действовать у самой отправки; ненастроенная служба не должна ничего ронять;
 * мёртвые адреса устройств должны убираться; в сообщение не должно попадать
 * лишнего.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import {
  buildAssertion,
  buildPushPayload,
  pushConfig,
  pushConfigured,
  resetPushTokenCache,
  sendPushToUsers,
} from "@/lib/push";

/** Настоящая пара ключей: подпись должна получаться, а не «как-нибудь». */
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const TOKEN = "d".repeat(140);

function configure() {
  process.env.FCM_PROJECT_ID = "trioz-test";
  process.env.FCM_CLIENT_EMAIL = "push@trioz-test.iam.gserviceaccount.com";
  /* В окружении ключ хранится с экранированными переводами строк — иначе его не
     положить в .env одной строкой. */
  process.env.FCM_PRIVATE_KEY = PEM.replace(/\n/g, "\\n");
}

function unconfigure() {
  delete process.env.FCM_PROJECT_ID;
  delete process.env.FCM_CLIENT_EMAIL;
  delete process.env.FCM_PRIVATE_KEY;
}

/** Ответы службы доставки: сначала пропуск, потом по одному на устройство. */
function mockFetch(...responses: { status: number; body?: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let index = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body ?? {},
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

/** Обычный ответ на запрос пропуска. */
const PASS = { status: 200, body: { access_token: "pass-1", expires_in: 3600 } };

beforeEach(() => {
  resetPushTokenCache();
  prismaMock.pushDevice.findMany.mockResolvedValue(row([]));
  prismaMock.pushDevice.deleteMany.mockResolvedValue(row({ count: 0 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  unconfigure();
});

describe("настройка доставки", () => {
  it("без переменных окружения доставка не настроена", () => {
    unconfigure();
    expect(pushConfig()).toBeNull();
    expect(pushConfigured()).toBe(false);
  });

  it("переводы строк в ключе разворачиваются обратно", () => {
    configure();
    expect(pushConfig()?.privateKey).toContain("-----BEGIN PRIVATE KEY-----\n");
    expect(pushConfig()?.privateKey).not.toContain("\\n");
  });

  /**
   * ИНВАРИАНТ: ненастроенная доставка ничего не ломает. Отсутствие доступа к
   * чужой службе не должно мешать ни отправке сообщения, ни созданию уведомления
   * в колокольчике.
   */
  it("ИНВАРИАНТ: без настройки отправка молча пропускается", async () => {
    unconfigure();
    const calls = mockFetch(PASS);
    const result = await sendPushToUsers(["u1"], { title: "Сообщение" });
    expect(result).toEqual({ sent: 0, removed: 0, skipped: true });
    expect(calls).toHaveLength(0);
    expect(prismaMock.pushDevice.findMany).not.toHaveBeenCalled();
  });
});

describe("подписанное утверждение", () => {
  it("состоит из трёх частей и подписывается настоящим ключом", () => {
    configure();
    const assertion = buildAssertion(pushConfig()!, Date.UTC(2026, 7, 2));
    const parts = assertion.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[2].length).toBeGreaterThan(100);
  });

  it("срок жизни — час от указанного момента", () => {
    configure();
    const now = Date.UTC(2026, 7, 2, 12, 0, 0);
    const claims = JSON.parse(
      Buffer.from(buildAssertion(pushConfig()!, now).split(".")[1], "base64url").toString(),
    ) as { iat: number; exp: number; scope: string };
    expect(claims.exp - claims.iat).toBe(3600);
    expect(claims.scope).toContain("firebase.messaging");
  });
});

describe("что уходит на устройство", () => {
  /**
   * ИНВАРИАНТ: в сообщении нет готового блока уведомления. Иначе система
   * показала бы его сама, и человек с ОТКРЫТЫМ приложением получал бы всё
   * дважды: от живого соединения и от службы доставки.
   */
  it("ИНВАРИАНТ: сообщение только с данными, без готового уведомления", () => {
    const payload = buildPushPayload(TOKEN, { title: "Ответ", body: "текст" }) as {
      message: Record<string, unknown>;
    };
    expect(payload.message.notification).toBeUndefined();
    expect(payload.message.data).toBeDefined();
  });

  it("все значения — строки: служба принимает только их", () => {
    const payload = buildPushPayload(TOKEN, { title: "Ответ" });
    for (const value of Object.values(payload.message.data)) {
      expect(typeof value).toBe("string");
    }
  });

  it("длинный текст обрезается, а не уходит целиком", () => {
    const payload = buildPushPayload(TOKEN, { title: "т".repeat(300), body: "б".repeat(900) });
    expect(payload.message.data.title.length).toBe(120);
    expect(payload.message.data.body.length).toBe(240);
  });

  /**
   * ИНВАРИАНТ: высокий приоритет. Иначе в режиме энергосбережения сообщение
   * ждёт «удобного случая» — для переписки это лишает смысла саму доставку.
   */
  it("ИНВАРИАНТ: приоритет высокий", () => {
    expect(buildPushPayload(TOKEN, { title: "Ответ" }).message.android.priority).toBe("HIGH");
  });
});

describe("отправка", () => {
  beforeEach(() => configure());

  it("получателей нет — ничего не делаем", async () => {
    const calls = mockFetch(PASS);
    expect(await sendPushToUsers([], { title: "Ответ" })).toEqual({ sent: 0, removed: 0, skipped: true });
    expect(calls).toHaveLength(0);
  });

  /**
   * ИНВАРИАНТ: выключивший уведомления в настройках аккаунта их не получает, и
   * проверка стоит здесь, у самой отправки. Если бы её делал каждый вызывающий,
   * выключатель работал бы только там, где о нём вспомнили.
   */
  it("ИНВАРИАНТ: выключатель уведомлений учтён в самом запросе устройств", async () => {
    mockFetch(PASS);
    await sendPushToUsers(["u1", "u2"], { title: "Ответ" });
    const args = prismaMock.pushDevice.findMany.mock.calls[0][0] as {
      where: { userId: { in: string[] }; user: { notifyPush: boolean } };
    };
    expect(args.where.userId.in).toEqual(["u1", "u2"]);
    expect(args.where.user.notifyPush).toBe(true);
  });

  it("устройств нет — пропуск даже не запрашивается", async () => {
    const calls = mockFetch(PASS);
    const result = await sendPushToUsers(["u1"], { title: "Ответ" });
    expect(result).toEqual({ sent: 0, removed: 0, skipped: false });
    expect(calls).toHaveLength(0);
  });

  it("на каждое устройство — своё сообщение", async () => {
    prismaMock.pushDevice.findMany.mockResolvedValue(
      row([{ id: "d1", token: TOKEN }, { id: "d2", token: `${TOKEN}2` }]),
    );
    const calls = mockFetch(PASS, { status: 200 }, { status: 200 });
    const result = await sendPushToUsers(["u1"], { title: "Ответ", link: "/connect" });
    expect(result.sent).toBe(2);
    /* Первый запрос — за пропуском, дальше по одному на устройство. */
    expect(calls[0].url).toContain("oauth2");
    expect(calls[1].url).toContain("trioz-test/messages:send");
    expect(calls).toHaveLength(3);
  });

  it("пропуск берётся один раз на все устройства", async () => {
    prismaMock.pushDevice.findMany.mockResolvedValue(
      row([{ id: "d1", token: TOKEN }, { id: "d2", token: `${TOKEN}2` }]),
    );
    const calls = mockFetch(PASS, { status: 200 }, { status: 200 });
    await sendPushToUsers(["u1"], { title: "Ответ" });
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
  });

  /**
   * ИНВАРИАНТ: мёртвый адрес убирается. Приложение снесли или переустановили —
   * адрес перестаёт существовать, и каждая следующая рассылка тратила бы время на
   * заведомо неудачную попытку.
   */
  it("ИНВАРИАНТ: устройство с мёртвым адресом удаляется", async () => {
    prismaMock.pushDevice.findMany.mockResolvedValue(row([{ id: "d1", token: TOKEN }]));
    mockFetch(PASS, { status: 404, body: { error: { status: "NOT_FOUND" } } });
    const result = await sendPushToUsers(["u1"], { title: "Ответ" });
    expect(result).toMatchObject({ sent: 0, removed: 1 });
    expect(prismaMock.pushDevice.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["d1"] } } });
  });

  it("незарегистрированный адрес тоже удаляется", async () => {
    prismaMock.pushDevice.findMany.mockResolvedValue(row([{ id: "d1", token: TOKEN }]));
    mockFetch(PASS, { status: 400, body: { error: { details: [{ errorCode: "UNREGISTERED" }] } } });
    expect((await sendPushToUsers(["u1"], { title: "Ответ" })).removed).toBe(1);
  });

  /**
   * ИНВАРИАНТ: временный сбой устройство НЕ удаляет. Иначе одна пятиминутка
   * неполадок у чужой службы отписала бы людей от уведомлений навсегда.
   */
  it("ИНВАРИАНТ: ошибка сервера доставки не удаляет устройство", async () => {
    prismaMock.pushDevice.findMany.mockResolvedValue(row([{ id: "d1", token: TOKEN }]));
    mockFetch(PASS, { status: 503, body: {} });
    const result = await sendPushToUsers(["u1"], { title: "Ответ" });
    expect(result).toMatchObject({ sent: 0, removed: 0 });
    expect(prismaMock.pushDevice.deleteMany).not.toHaveBeenCalled();
  });

  /**
   * ИНВАРИАНТ: упавшая сеть не бросает исключение наружу. Уведомление в
   * колокольчике уже создано, и ронять его из-за чужой службы нельзя.
   */
  it("ИНВАРИАНТ: недоступная сеть не ломает вызывающего", async () => {
    prismaMock.pushDevice.findMany.mockResolvedValue(row([{ id: "d1", token: TOKEN }]));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("oauth2")) {
        return { ok: true, status: 200, json: async () => PASS.body } as unknown as Response;
      }
      throw new Error("сеть недоступна");
    }));
    await expect(sendPushToUsers(["u1"], { title: "Ответ" })).resolves.toMatchObject({ sent: 0 });
  });

  it("служба не выдала пропуск — отправки нет, и это не ошибка", async () => {
    prismaMock.pushDevice.findMany.mockResolvedValue(row([{ id: "d1", token: TOKEN }]));
    const calls = mockFetch({ status: 401, body: {} });
    const result = await sendPushToUsers(["u1"], { title: "Ответ" });
    expect(result).toEqual({ sent: 0, removed: 0, skipped: true });
    expect(calls).toHaveLength(1);
  });

  it("повторы получателей не дают повторных отправок", async () => {
    prismaMock.pushDevice.findMany.mockResolvedValue(row([]));
    mockFetch(PASS);
    await sendPushToUsers(["u1", "u1", "u1"], { title: "Ответ" });
    const args = prismaMock.pushDevice.findMany.mock.calls[0][0] as { where: { userId: { in: string[] } } };
    expect(args.where.userId.in).toEqual(["u1"]);
  });
});
