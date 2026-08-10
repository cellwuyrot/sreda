/**
 * Тесты: src/lib/createNotification.ts — из-за кого и о чём уведомление.
 *
 * Оба поля появились из багов, и оба бага пользователь видел своими глазами:
 *
 *   1. «Перешёл, прочёл — уведомление не пропало». Пометка о прочтении искала
 *      записи сопоставлением ТЕКСТА ссылки. У обращений ссылка ведёт в раздел
 *      админки, а не в заявку, — сопоставить было нечем, и прочитанное обращение
 *      навсегда оставалось непрочитанным уведомлением.
 *   2. «Удалил тестовый аккаунт — уведомление осталось». О человеке в записи
 *      оставался только замороженный текст, никакой связи с самим аккаунтом.
 *
 * Отсюда предмет (`entityType` + `entityId`) и виновник (`actorId`) — и тесты
 * стоят ровно на них.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/socketEmit", () => ({ getIO: () => null }));

/* Доставку на устройство подменяем: её внутренности проверяет lib/push.test.ts, а
   здесь важно другое — что она вообще вызывается из единственного места, где
   рождаются уведомления, и с правильными данными. */
const queuePush = vi.fn();
vi.mock("@/lib/push", () => ({ queuePush: (...a: unknown[]) => queuePush(...a) }));

import {
  createNotification,
  createNotificationsBulk,
  deleteSubjectNotifications,
  markSubjectNotificationsRead,
} from "@/lib/createNotification";

beforeEach(() => {
  queuePush.mockClear();
  prismaMock.user.findUnique.mockResolvedValue(row({ notifyPush: true }));
  prismaMock.notification.create.mockResolvedValue(row({ id: "n1", userId: "u1" }));
  prismaMock.notification.createManyAndReturn.mockResolvedValue(row([{ id: "n1", userId: "u1" }]));
  prismaMock.notification.updateMany.mockResolvedValue(row({ count: 1 }));
  prismaMock.notification.deleteMany.mockResolvedValue(row({ count: 2 }));
  prismaMock.notification.count.mockResolvedValue(row(3));
});

describe("создание: виновник и предмет", () => {
  /**
   * ИНВАРИАНТ: уведомление знает, из-за кого оно. На этом держится исчезновение
   * записи вместе с удалённым аккаунтом — каскад по `actorId` в схеме.
   */
  it("ИНВАРИАНТ: виновник и предмет доходят до записи", async () => {
    await createNotification({
      userId: "admin-1",
      type: "appeal",
      title: "Новое обращение пользователя",
      actorId: "client-9",
      entityType: "appeal",
      entityId: "appeal-7",
    });
    const args = prismaMock.notification.create.mock.calls[0][0] as {
      data: { actorId: string | null; entityType: string | null; entityId: string | null };
    };
    expect(args.data).toMatchObject({ actorId: "client-9", entityType: "appeal", entityId: "appeal-7" });
  });

  /**
   * ИНВАРИАНТ: «из-за самого получателя» не бывает. Такая связь ничего не
   * добавляет (запись и так уйдёт с получателем по `userId`), зато сбивает смысл
   * поля: оно про того, чьё действие вызвало уведомление.
   */
  it("ИНВАРИАНТ: получатель не может быть виновником", async () => {
    await createNotification({ userId: "u1", type: "dm", title: "Сообщение", actorId: "u1" });
    const args = prismaMock.notification.create.mock.calls[0][0] as { data: { actorId: string | null } };
    expect(args.data.actorId).toBeNull();
  });

  it("без виновника и предмета поля пустые, а не отсутствуют", async () => {
    await createNotification({ userId: "u1", type: "system", title: "Объявление" });
    const args = prismaMock.notification.create.mock.calls[0][0] as {
      data: { actorId: string | null; entityType: string | null; entityId: string | null };
    };
    expect(args.data).toMatchObject({ actorId: null, entityType: null, entityId: null });
  });

  it("рассылка пачкой тоже несёт виновника и предмет", async () => {
    prismaMock.user.findMany.mockResolvedValue(row([{ id: "a1", notifyPush: true }, { id: "a2", notifyPush: true }]));
    await createNotificationsBulk({
      userIds: ["a1", "a2"],
      type: "appeal",
      title: "Новое обращение",
      actorId: "client-9",
      entityType: "appeal",
      entityId: "appeal-7",
    });
    const args = prismaMock.notification.createManyAndReturn.mock.calls[0][0] as {
      data: { userId: string; actorId: string | null; entityId: string | null }[];
    };
    expect(args.data).toHaveLength(2);
    for (const item of args.data) {
      expect(item.actorId).toBe("client-9");
      expect(item.entityId).toBe("appeal-7");
    }
  });

  /**
   * ИНВАРИАНТ: в рассылке правило «не из-за себя» действует поштучно. Автор
   * обращения может оказаться в списке разбирающих (администратор пишет сам себе
   * заявку) — и его собственная запись не должна ссылаться на него же.
   */
  it("ИНВАРИАНТ: в рассылке виновник снимается только у себя самого", async () => {
    prismaMock.user.findMany.mockResolvedValue(row([{ id: "a1", notifyPush: true }, { id: "client-9", notifyPush: true }]));
    await createNotificationsBulk({
      userIds: ["a1", "client-9"],
      type: "appeal",
      title: "Новое обращение",
      actorId: "client-9",
      entityType: "appeal",
      entityId: "appeal-7",
    });
    const args = prismaMock.notification.createManyAndReturn.mock.calls[0][0] as {
      data: { userId: string; actorId: string | null }[];
    };
    expect(args.data.find((item) => item.userId === "a1")?.actorId).toBe("client-9");
    expect(args.data.find((item) => item.userId === "client-9")?.actorId).toBeNull();
  });
});

describe("markSubjectNotificationsRead", () => {
  /**
   * ИНВАРИАНТ И ЕСТЬ САМ БАГ: прочитанное гасится по предмету. Раньше — по тексту
   * ссылки, и у обращений совпасть было нечему.
   */
  it("ИНВАРИАНТ: гасятся свои непрочитанные по этому предмету", async () => {
    await markSubjectNotificationsRead({ userId: "u1", entityType: "appeal", entityId: "appeal-7" });
    const args = prismaMock.notification.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: { read: boolean };
    };
    expect(args.where).toEqual({ userId: "u1", read: false, entityType: "appeal", entityId: "appeal-7" });
    expect(args.data).toEqual({ read: true });
  });

  /**
   * ИНВАРИАНТ: чужих уведомлений это не касается. Открыв заявку, администратор
   * гасит своё уведомление, а не уведомление коллеги, которому ещё предстоит её
   * прочитать.
   */
  it("ИНВАРИАНТ: гасятся только уведомления того, кто читает", async () => {
    await markSubjectNotificationsRead({ userId: "u1", entityType: "dm", entityId: "conv-1" });
    const args = prismaMock.notification.updateMany.mock.calls[0][0] as { where: { userId: string } };
    expect(args.where.userId).toBe("u1");
  });

  /**
   * ИНВАРИАНТ: записи, созданные до появления предмета, не брошены. Иначе
   * починка выглядела бы как «у меня всё равно висит непрочитанное» — просто по
   * дате создания записи.
   */
  it("ИНВАРИАНТ: старые записи гасятся прежним способом", async () => {
    await markSubjectNotificationsRead({
      userId: "u1",
      entityType: "dm",
      entityId: "conv-1",
      legacyWhere: { userId: "u1", read: false, type: "dm", entityId: null, link: { contains: "dm=peer&" } },
    });
    const args = prismaMock.notification.updateMany.mock.calls[0][0] as {
      where: { userId: string; read: boolean; OR: Record<string, unknown>[] };
    };
    expect(args.where.OR).toHaveLength(2);
    expect(args.where.OR[0]).toMatchObject({ entityType: "dm", entityId: "conv-1" });
    expect(args.where.OR[1]).toMatchObject({ type: "dm", entityId: null });
  });

  it("возвращает погашенное и остаток непрочитанного", async () => {
    prismaMock.notification.updateMany.mockResolvedValue(row({ count: 2 }));
    prismaMock.notification.count.mockResolvedValue(row(5));
    const result = await markSubjectNotificationsRead({ userId: "u1", entityType: "appeal", entityId: "a1" });
    expect(result).toEqual({ marked: 2, unreadLeft: 5 });
  });
});

describe("deleteSubjectNotifications", () => {
  /**
   * ИНВАРИАНТ: уведомление о том, чего больше нет, убирается. Запись, ведущая в
   * пустоту, хуже отсутствия записи: человек идёт по ссылке и не находит ничего.
   */
  it("ИНВАРИАНТ: убираются все записи о предмете, у всех получателей", async () => {
    const count = await deleteSubjectNotifications("appeal", "appeal-7");
    expect(count).toBe(2);
    const args = prismaMock.notification.deleteMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ entityType: "appeal", entityId: "appeal-7" });
  });
});

// ── Доставка в закрытое приложение ─────────────────────────────────────────

describe("доставка на устройство", () => {
  /**
   * ИНВАРИАНТ И ЕСТЬ ПРИЧИНА ПРАВКИ: уведомление должно доходить и в ЗАКРЫТОЕ
   * приложение. Событие по живому соединению доходит только до открытого — а
   * закрытый мессенджер молчал до следующего запуска.
   */
  it("ИНВАРИАНТ: создание уведомления запускает доставку на устройство", async () => {
    await createNotification({
      userId: "u1",
      type: "dm",
      title: "Новое сообщение от Андрея",
      body: "привет",
      link: "/connect?section=dm&dm=u2",
      entityType: "dm",
      entityId: "conv-1",
    });
    expect(queuePush).toHaveBeenCalledWith(["u1"], {
      title: "Новое сообщение от Андрея",
      body: "привет",
      link: "/connect?section=dm&dm=u2",
      /* Метка схлопывает уведомления одной беседы в одно — как у живых. */
      tag: "dm:conv-1",
    });
  });

  /**
   * ИНВАРИАНТ: выключивший уведомления не получает и доставку на устройство.
   * Иначе выключатель означал бы «тише в приложении, но громче в телефоне».
   */
  it("ИНВАРИАНТ: при выключенных уведомлениях доставки нет", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row({ notifyPush: false }));
    await createNotification({ userId: "u1", type: "dm", title: "Сообщение" });
    expect(queuePush).not.toHaveBeenCalled();
  });

  it("без предмета метка берётся по виду уведомления", async () => {
    await createNotification({ userId: "u1", type: "appeal", title: "Обращение закрыто" });
    expect(queuePush.mock.calls[0][1]).toMatchObject({ tag: "appeal" });
  });

  it("рассылка пачкой доставляется всем сразу, одним вызовом", async () => {
    prismaMock.user.findMany.mockResolvedValue(
      row([{ id: "a1", notifyPush: true }, { id: "a2", notifyPush: true }]),
    );
    await createNotificationsBulk({
      userIds: ["a1", "a2"],
      type: "appeal",
      title: "Новое обращение",
      entityType: "appeal",
      entityId: "ap-7",
    });
    expect(queuePush).toHaveBeenCalledTimes(1);
    expect(queuePush.mock.calls[0][0]).toEqual(["a1", "a2"]);
    expect(queuePush.mock.calls[0][1]).toMatchObject({ tag: "appeal:ap-7" });
  });

  it("ИНВАРИАНТ: в рассылке выключившие исключаются поимённо", async () => {
    prismaMock.user.findMany.mockResolvedValue(
      row([{ id: "a1", notifyPush: true }, { id: "a2", notifyPush: false }]),
    );
    await createNotificationsBulk({ userIds: ["a1", "a2"], type: "appeal", title: "Новое обращение" });
    expect(queuePush.mock.calls[0][0]).toEqual(["a1"]);
  });
});
