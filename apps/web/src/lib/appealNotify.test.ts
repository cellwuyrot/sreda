/**
 * Тесты: src/lib/appealNotify.ts
 * Договор: кому уходят уведомления по обращениям и в каком виде.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const createNotification = vi.fn();
const createNotificationsBulk = vi.fn();
vi.mock("@/lib/createNotification", () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
  createNotificationsBulk: (...a: unknown[]) => createNotificationsBulk(...a),
}));

/* Почту подменяем: настоящий модуль при загрузке поднимает транспорт SMTP и
   проверяет соединение — в тестах это лишняя сеть, а проверить нужно другое:
   что письмо уходит тем же получателям, что и уведомление. */
const mailNewAppeal = vi.fn().mockResolvedValue(1);
const mailAppealReplyToClient = vi.fn().mockResolvedValue(1);
const mailAppealReplyToStaff = vi.fn().mockResolvedValue(1);
const mailAppealStatus = vi.fn().mockResolvedValue(1);
vi.mock("@/lib/appealMail", () => ({
  mailNewAppeal: (...a: unknown[]) => mailNewAppeal(...a),
  mailAppealReplyToClient: (...a: unknown[]) => mailAppealReplyToClient(...a),
  mailAppealReplyToStaff: (...a: unknown[]) => mailAppealReplyToStaff(...a),
  mailAppealStatus: (...a: unknown[]) => mailAppealStatus(...a),
}));

import { appealHandlerIds, notifyNewAppeal, notifyAppealReply, notifyAppealStatus } from "@/lib/appealNotify";

beforeEach(() => {
  createNotification.mockReset();
  createNotificationsBulk.mockReset();
  mailNewAppeal.mockClear().mockResolvedValue(1);
  mailAppealReplyToClient.mockClear().mockResolvedValue(1);
  mailAppealReplyToStaff.mockClear().mockResolvedValue(1);
  mailAppealStatus.mockClear().mockResolvedValue(1);
});

// ---------------------------------------------------------------------------
// appealHandlerIds
// ---------------------------------------------------------------------------

describe("appealHandlerIds", () => {
  it("запрашивает пользователей с ролями ADMIN и EDITOR", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await appealHandlerIds();
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ["ADMIN", "EDITOR"] },
        }),
      })
    );
  });

  it("исключает переданный excludeUserId из результата", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "admin1" },
      { id: "editor1" },
      { id: "admin2" },
    ] as never);
    const ids = await appealHandlerIds("admin1");
    expect(ids).not.toContain("admin1");
    expect(ids).toContain("editor1");
    expect(ids).toContain("admin2");
  });

  it("возвращает пустой массив, если нет подходящих пользователей", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    const ids = await appealHandlerIds("u1");
    expect(ids).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// notifyNewAppeal
// ---------------------------------------------------------------------------

describe("notifyNewAppeal", () => {
  it("рассылает пачкой (createNotificationsBulk), а не по одному", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }, { id: "editor1" }] as never);
    createNotificationsBulk.mockResolvedValue(2);
    await notifyNewAppeal({
      actorId: "user1",
      authorName: "User One",
      subject: "Тема обращения",
      isBanAppeal: false,
    });
    expect(createNotificationsBulk).toHaveBeenCalledTimes(1);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("не уведомляет самого отправителя", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "admin1" },
      { id: "user1" }, // сам отправитель (если бы был ADMIN)
    ] as never);
    createNotificationsBulk.mockResolvedValue(1);
    await notifyNewAppeal({
      actorId: "user1",
      authorName: "User One",
      subject: "Тема",
      isBanAppeal: false,
    });
    const callArgs = createNotificationsBulk.mock.calls[0][0] as { userIds: string[] };
    expect(callArgs.userIds).not.toContain("user1");
    expect(callArgs.userIds).toContain("admin1");
  });

  it("при isBanAppeal=true заголовок содержит «блокировки»", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }] as never);
    createNotificationsBulk.mockResolvedValue(1);
    await notifyNewAppeal({
      actorId: "user1",
      authorName: "User",
      subject: "Разблокируйте",
      isBanAppeal: true,
    });
    const callArgs = createNotificationsBulk.mock.calls[0][0] as { title: string };
    expect(callArgs.title).toContain("блокировки");
  });

  it("при isBanAppeal=false заголовок не содержит «блокировки»", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }] as never);
    createNotificationsBulk.mockResolvedValue(1);
    await notifyNewAppeal({
      actorId: "user1",
      authorName: "User",
      subject: "Общий вопрос",
      isBanAppeal: false,
    });
    const callArgs = createNotificationsBulk.mock.calls[0][0] as { title: string };
    expect(callArgs.title).not.toContain("блокировки");
  });
});

// ---------------------------------------------------------------------------
// notifyAppealReply
// ---------------------------------------------------------------------------

describe("notifyAppealReply", () => {
  it("fromAdmin: true — уведомляет автора одним вызовом createNotification", async () => {
    createNotification.mockResolvedValue({});
    await notifyAppealReply({
      actorId: "admin1",
      actorName: "Admin",
      authorId: "user1",
      subject: "Тема",
      body: "Ответ администратора",
      fromAdmin: true,
    });
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user1" })
    );
    expect(createNotificationsBulk).not.toHaveBeenCalled();
  });

  it("fromAdmin: false — рассылает разбирающим через createNotificationsBulk", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }, { id: "editor1" }] as never);
    createNotificationsBulk.mockResolvedValue(2);
    await notifyAppealReply({
      actorId: "user1",
      actorName: "User One",
      authorId: "user1",
      subject: "Тема",
      body: "Дополнение к обращению",
      fromAdmin: false,
    });
    expect(createNotificationsBulk).toHaveBeenCalledTimes(1);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("fromAdmin: true — НЕ уведомляет, если автор и есть отправитель (admin писал в своё обращение)", async () => {
    await notifyAppealReply({
      actorId: "admin1",
      actorName: "Admin",
      authorId: "admin1", // автор = отправитель
      subject: "Тема",
      body: "Дополнение",
      fromAdmin: true,
    });
    expect(createNotification).not.toHaveBeenCalled();
    expect(createNotificationsBulk).not.toHaveBeenCalled();
  });

  it("тело уведомления содержит выжимку (excerpt) ответа", async () => {
    createNotification.mockResolvedValue({});
    const longBody = "А".repeat(200);
    await notifyAppealReply({
      actorId: "admin1",
      actorName: "Admin",
      authorId: "user1",
      subject: "Тема",
      body: longBody,
      fromAdmin: true,
    });
    const callArgs = createNotification.mock.calls[0][0] as { body: string };
    // excerpt обрезает до 140 символов, добавляет «…»
    expect(callArgs.body.length).toBeLessThan(longBody.length);
    expect(callArgs.body).toContain("…");
  });

  it("короткий ответ не обрезается и не содержит «…»", async () => {
    createNotification.mockResolvedValue({});
    const shortBody = "Короткий ответ";
    await notifyAppealReply({
      actorId: "admin1",
      actorName: "Admin",
      authorId: "user1",
      subject: "Тема",
      body: shortBody,
      fromAdmin: true,
    });
    const callArgs = createNotification.mock.calls[0][0] as { body: string };
    expect(callArgs.body).toContain(shortBody);
    expect(callArgs.body).not.toContain("…");
  });
});

// ---------------------------------------------------------------------------
// notifyAppealStatus
// ---------------------------------------------------------------------------

describe("notifyAppealStatus", () => {
  it("уведомляет автора одним вызовом createNotification", async () => {
    createNotification.mockResolvedValue({});
    await notifyAppealStatus({
      actorId: "admin1",
      authorId: "user1",
      subject: "Тема",
      status: "CLOSED",
    });
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user1" })
    );
  });

  it("не уведомляет, когда статус меняет сам автор", async () => {
    await notifyAppealStatus({
      actorId: "user1",
      authorId: "user1", // автор сам меняет статус
      subject: "Тема",
      status: "CLOSED",
    });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("статус CLOSED подписывается по-русски «закрыто»", async () => {
    createNotification.mockResolvedValue({});
    await notifyAppealStatus({
      actorId: "admin1",
      authorId: "user1",
      subject: "Тема",
      status: "CLOSED",
    });
    const callArgs = createNotification.mock.calls[0][0] as { title: string };
    expect(callArgs.title).toContain("закрыто");
    expect(callArgs.title).not.toContain("CLOSED");
  });

  it("статус IN_PROGRESS подписывается по-русски «в работе»", async () => {
    createNotification.mockResolvedValue({});
    await notifyAppealStatus({
      actorId: "admin1",
      authorId: "user1",
      subject: "Тема",
      status: "IN_PROGRESS",
    });
    const callArgs = createNotification.mock.calls[0][0] as { title: string };
    expect(callArgs.title).toContain("в работе");
    expect(callArgs.title).not.toContain("IN_PROGRESS");
  });

  it("статус OPEN подписывается по-русски «открыто»", async () => {
    createNotification.mockResolvedValue({});
    await notifyAppealStatus({
      actorId: "admin1",
      authorId: "user1",
      subject: "Тема",
      status: "OPEN",
    });
    const callArgs = createNotification.mock.calls[0][0] as { title: string };
    expect(callArgs.title).toContain("открыто");
    expect(callArgs.title).not.toContain("OPEN");
  });
});

// ---------------------------------------------------------------------------
// Письма: уведомление и письмо ходят парой
// ---------------------------------------------------------------------------

describe("письма по обращениям", () => {
  it("новое обращение: письмо уходит тем же получателям, что и уведомление", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "editor-1" }] as never);

    await notifyNewAppeal({
      actorId: "client-1",
      authorName: "Клиент",
      subject: "Сотрудничество",
      isBanAppeal: false,
      body: "Текст заявки",
    });

    expect(mailNewAppeal).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ["admin-1", "editor-1"], subject: "Сотрудничество" })
    );
  });

  it("ответ администратора: письмо уходит автору обращения", async () => {
    await notifyAppealReply({
      actorId: "admin-1",
      actorName: "Админ",
      authorId: "client-1",
      subject: "Сотрудничество",
      body: "Готовы обсудить",
      fromAdmin: true,
    });

    expect(mailAppealReplyToClient).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "client-1", body: "Готовы обсудить" })
    );
    expect(mailAppealReplyToStaff).not.toHaveBeenCalled();
  });

  it("дополнение автора: письмо уходит администрации", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin-1" }] as never);

    await notifyAppealReply({
      actorId: "client-1",
      actorName: "Клиент",
      authorId: "client-1",
      subject: "Сотрудничество",
      body: "Дополню",
      fromAdmin: false,
    });

    expect(mailAppealReplyToStaff).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ["admin-1"] })
    );
    expect(mailAppealReplyToClient).not.toHaveBeenCalled();
  });

  it("смена состояния: письмо уходит автору с человеческой подписью состояния", async () => {
    await notifyAppealStatus({
      actorId: "admin-1",
      authorId: "client-1",
      subject: "Сотрудничество",
      status: "CLOSED",
    });

    expect(mailAppealStatus).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "client-1", statusLabel: "закрыто" })
    );
  });

  /**
   * ИНВАРИАНТ: письмо не должно ронять действие. Почта — вторичный канал: если
   * сервис недоступен, уведомление всё равно записано, а исключение наружу не
   * выходит.
   */
  it("ИНВАРИАНТ: упавшая отправка письма не ломает уведомление", async () => {
    mailAppealStatus.mockRejectedValue(new Error("сервис недоступен"));

    await expect(
      notifyAppealStatus({
        actorId: "admin-1",
        authorId: "client-1",
        subject: "Тема",
        status: "OPEN",
      })
    ).resolves.toBeUndefined();

    expect(createNotification).toHaveBeenCalled();
  });
});

// ── Привязка к заявке и к автору действия ──────────────────────────────────

describe("уведомление знает, о ком и о чём", () => {
  /**
   * ИНВАРИАНТ И ЕСТЬ САМ БАГ: у уведомления о новом обращении должен быть предмет
   * (заявка) и виновник (её автор). Без предмета прочитанная заявка оставляла
   * уведомление непрочитанным навсегда; без виновника удаление аккаунта оставляло
   * уведомление с именем, которого больше нет.
   */
  it("ИНВАРИАНТ: новое обращение несёт заявку и автора", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }, { id: "editor1" }] as never);
    await notifyNewAppeal({
      appealId: "ap-7",
      actorId: "client-9",
      authorName: "Клиент",
      subject: "Сотрудничество",
      isBanAppeal: false,
    });
    expect(createNotificationsBulk).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "client-9", entityType: "appeal", entityId: "ap-7" }),
    );
  });

  it("ИНВАРИАНТ: ответ администрации автору несёт ту же заявку", async () => {
    await notifyAppealReply({
      appealId: "ap-7",
      actorId: "admin1",
      actorName: "Админ",
      authorId: "client-9",
      subject: "Сотрудничество",
      body: "Ответ",
      fromAdmin: true,
    });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "admin1", entityType: "appeal", entityId: "ap-7" }),
    );
  });

  it("ИНВАРИАНТ: дополнение автора администрации — тоже с заявкой", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }] as never);
    await notifyAppealReply({
      appealId: "ap-7",
      actorId: "client-9",
      actorName: "Клиент",
      authorId: "client-9",
      subject: "Сотрудничество",
      body: "Дополняю",
      fromAdmin: false,
    });
    expect(createNotificationsBulk).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "client-9", entityType: "appeal", entityId: "ap-7" }),
    );
  });

  it("ИНВАРИАНТ: смена статуса — тоже привязана к заявке", async () => {
    await notifyAppealStatus({
      appealId: "ap-7",
      actorId: "admin1",
      authorId: "client-9",
      subject: "Сотрудничество",
      status: "CLOSED",
    });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "admin1", entityType: "appeal", entityId: "ap-7" }),
    );
  });
});
