/**
 * Тесты: src/lib/appealMail.ts
 *
 * Договор письма по обращению: кому оно уходит, что в нём есть и чего в нём быть
 * не должно. Сам почтовый модуль подменён — проверяем не доставку, а решение
 * «отправлять или нет» и содержимое.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

/* Настоящий lib/email при загрузке поднимает транспорт SMTP и проверяет
   соединение. В тестах это лишняя сеть, а нужен только факт вызова. */
const sendEmail = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

import {
  mailNewAppeal,
  mailAppealReplyToClient,
  mailAppealReplyToStaff,
  mailAppealStatus,
} from "@/lib/appealMail";

const ORIGINAL_URL = process.env.NEXTAUTH_URL;

beforeEach(() => {
  sendEmail.mockClear().mockResolvedValue(true);
  process.env.NEXTAUTH_URL = "https://trioz.ru";
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ORIGINAL_URL;
});

/** Один получатель с включёнными письмами. */
function oneRecipient(email = "admin@trioz.ru", name = "Админ") {
  prismaMock.user.findMany.mockResolvedValue(row([{ email, name }]));
}

/** Последнее отправленное письмо. */
function lastLetter() {
  return sendEmail.mock.calls[sendEmail.mock.calls.length - 1][0] as {
    to: string;
    subject: string;
    html: string;
    text: string;
  };
}

// ─── Кому отправляем ───────────────────────────────────────────────────────────

describe("выбор получателей", () => {
  it("спрашивает только тех, кто письма не выключал", async () => {
    prismaMock.user.findMany.mockResolvedValue(row([]));

    await mailNewAppeal({
      userIds: ["admin-1"],
      authorName: "Клиент",
      subject: "Тема",
      body: "Текст",
      isBanAppeal: false,
    });

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ notifyEmail: true }),
      })
    );
  });

  it("пустой список получателей — в базу не ходим вовсе", async () => {
    await mailNewAppeal({
      userIds: [],
      authorName: "Клиент",
      subject: "Тема",
      body: "Текст",
      isBanAppeal: false,
    });

    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("повторы в списке не дают двух писем одному человеку", async () => {
    prismaMock.user.findMany.mockResolvedValue(row([]));

    await mailNewAppeal({
      userIds: ["admin-1", "admin-1"],
      authorName: "Клиент",
      subject: "Тема",
      body: "Текст",
      isBanAppeal: false,
    });

    const call = prismaMock.user.findMany.mock.calls[0][0] as {
      where: { id: { in: string[] } };
    };
    expect(call.where.id.in).toEqual(["admin-1"]);
  });

  /**
   * ИНВАРИАНТ: без адреса письма нет. Учётная запись без почты возможна, и
   * попытка отправить «в никуда» дала бы ошибку сервиса на каждое обращение.
   */
  it("ИНВАРИАНТ: получателю без адреса письмо не отправляется", async () => {
    prismaMock.user.findMany.mockResolvedValue(
      row([{ email: null, name: "Без почты" }, { email: "ok@trioz.ru", name: "С почтой" }])
    );

    const sent = await mailAppealReplyToStaff({
      userIds: ["a", "b"],
      actorName: "Клиент",
      subject: "Тема",
      body: "Текст",
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(lastLetter().to).toBe("ok@trioz.ru");
    expect(sent).toBe(1);
  });

  it("упавшая отправка одному не срывает отправку остальным", async () => {
    prismaMock.user.findMany.mockResolvedValue(
      row([{ email: "one@trioz.ru", name: "Раз" }, { email: "two@trioz.ru", name: "Два" }])
    );
    sendEmail.mockRejectedValueOnce(new Error("сервис недоступен")).mockResolvedValue(true);

    const sent = await mailAppealReplyToStaff({
      userIds: ["a", "b"],
      actorName: "Клиент",
      subject: "Тема",
      body: "Текст",
    });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sent).toBe(1);
  });
});

// ─── Что внутри письма ────────────────────────────────────────────────────────

describe("содержимое письма", () => {
  /**
   * У писем с кодами входа темы записаны латиницей — так обходили порчу
   * кириллицы в заголовках. Письма по обращениям следуют тому же правилу: тело
   * кириллическое, тема латиницей.
   */
  it("ИНВАРИАНТ: тема письма без кириллицы", async () => {
    oneRecipient();

    await mailNewAppeal({
      userIds: ["admin-1"],
      authorName: "Клиент",
      subject: "Сотрудничество",
      body: "Текст",
      isBanAppeal: false,
    });

    expect(lastLetter().subject).not.toMatch(/[А-Яа-яЁё]/);
  });

  it("тема обращения и текст заявки попадают в письмо", async () => {
    oneRecipient();

    await mailNewAppeal({
      userIds: ["admin-1"],
      authorName: "Клиент",
      subject: "Сотрудничество",
      body: "Хочу продвигать продукт",
      isBanAppeal: false,
    });

    const letter = lastLetter();
    expect(letter.html).toContain("Сотрудничество");
    expect(letter.html).toContain("Хочу продвигать продукт");
    expect(letter.text).toContain("Хочу продвигать продукт");
  });

  it("обжалование блокировки называется своим именем", async () => {
    oneRecipient();

    await mailNewAppeal({
      userIds: ["admin-1"],
      authorName: "Клиент",
      subject: "Верните доступ",
      body: "Текст",
      isBanAppeal: true,
    });

    expect(lastLetter().html).toContain("Новое обжалование блокировки");
  });

  /**
   * ИНВАРИАНТ: текст человека попадает в разметку письма, поэтому его нужно
   * экранировать. Иначе заявка с угловыми скобками ломает вёрстку письма, а в
   * худшем случае подставляет в него чужую ссылку.
   */
  it("ИНВАРИАНТ: разметка из текста заявки экранируется", async () => {
    oneRecipient();

    await mailAppealReplyToClient({
      userId: "client-1",
      subject: "Тема",
      body: '<script>alert("привет")</script>',
    });

    const html = lastLetter().html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("длинный текст в письме обрезается", async () => {
    oneRecipient();

    await mailAppealReplyToClient({
      userId: "client-1",
      subject: "Тема",
      body: "я".repeat(2000),
    });

    expect(lastLetter().text).toContain("…");
  });

  it("кнопка ведёт на адрес сайта", async () => {
    oneRecipient();

    await mailAppealReplyToClient({ userId: "client-1", subject: "Тема", body: "Ответ" });

    expect(lastLetter().html).toContain("https://trioz.ru/connect?section=business");
  });

  it("без адреса сайта кнопки в письме нет — ссылка в никуда хуже её отсутствия", async () => {
    delete process.env.NEXTAUTH_URL;
    oneRecipient();

    await mailAppealReplyToClient({ userId: "client-1", subject: "Тема", body: "Ответ" });

    const letter = lastLetter();
    expect(letter.html).not.toContain("<a href");
    expect(letter.text).not.toContain("http");
  });

  it("состояние обращения написано словами", async () => {
    oneRecipient();

    await mailAppealStatus({ userId: "client-1", subject: "Тема", statusLabel: "закрыто" });

    expect(lastLetter().html).toContain("закрыто");
  });
});
