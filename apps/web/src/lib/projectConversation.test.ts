/**
 * Тесты: src/lib/projectConversation.ts — один разговор по проекту.
 *
 * У проекта был собственный «Чат по проекту» при том, что по тому же вопросу у
 * заказчика уже открыт деловой чат по обращению. Правка убирает второе место
 * для одного разговора, и здесь проверяется, что она никого не потеряла:
 *
 *   • уже привязанное обращение переиспользуется, а не заводится второе;
 *   • незакрытая заявка на сотрудничество по ТОЙ ЖЕ услуге считается «тем самым»
 *     разговором — именно её человек подавал кнопкой «Сотрудничество»;
 *   • чужое обращение (обжалование бана, вопрос в поддержку) не подхватывается;
 *   • связь запоминается в проекте — второе нажатие ведёт в тот же чат.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const ensureBusinessChat = vi.fn();
vi.mock("@/lib/businessChat", () => ({
  ensureBusinessChat: (...a: unknown[]) => ensureBusinessChat(...a),
}));

const ensureAppealsChannel = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/mainCommunity", () => ({
  ensureAppealsChannel: (...a: unknown[]) => ensureAppealsChannel(...a),
}));

const notifyNewAppeal = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/appealNotify", () => ({
  notifyNewAppeal: (...a: unknown[]) => notifyNewAppeal(...a),
}));

const { ensureProjectConversation, cooperationSubject } = await import("@/lib/projectConversation");

const PROJECT = {
  id: "p1",
  name: "Маркировка обуви",
  purpose: "Подключить магазин к маркировке",
  ownerId: "client",
  appealId: null as string | null,
  service: { id: "svc1", title: "Честный Знак" },
};

beforeEach(() => {
  ensureBusinessChat.mockReset().mockResolvedValue("conv1");
  ensureAppealsChannel.mockClear();
  notifyNewAppeal.mockClear().mockResolvedValue(undefined);
  prismaMock.appeal.findUnique.mockResolvedValue(null as never);
  prismaMock.appeal.findFirst.mockResolvedValue(null as never);
  prismaMock.appeal.create.mockResolvedValue(row({ id: "new-appeal" }));
  prismaMock.channel.findFirst.mockResolvedValue(row({ id: "appeals-channel" }));
  prismaMock.partnerProject.update.mockResolvedValue(row({ id: "p1" }));
  prismaMock.user.findUnique.mockResolvedValue(row({ name: "Клиент" }));
});

describe("уже привязанное обращение", () => {
  it("ИНВАРИАНТ: второй раз обращение не заводится", async () => {
    /* Иначе каждое нажатие кнопки плодило бы новый разговор о том же самом, и
       переписка размазалась бы по десятку чатов. */
    prismaMock.appeal.findUnique.mockResolvedValue(row({ id: "ap1", subject: "Тема", body: "Текст" }));
    const link = await ensureProjectConversation({ ...PROJECT, appealId: "ap1" }, "client");
    expect(link).toEqual({ appealId: "ap1", conversationId: "conv1" });
    expect(prismaMock.appeal.create).not.toHaveBeenCalled();
    expect(notifyNewAppeal).not.toHaveBeenCalled();
    /* Ссылка не менялась — лишней записи в базу нет. */
    expect(prismaMock.partnerProject.update).not.toHaveBeenCalled();
  });

  it("исчезнувшее обращение не роняет переход, а заводит новое", async () => {
    /* Обращение могли удалить вместе с каналом: ссылка тогда указывает в
       пустоту, и кнопка обязана открыть разговор, а не упасть. */
    prismaMock.appeal.findUnique.mockResolvedValue(null as never);
    const link = await ensureProjectConversation({ ...PROJECT, appealId: "пропало" }, "client");
    expect(link?.appealId).toBe("new-appeal");
    expect(prismaMock.appeal.create).toHaveBeenCalled();
  });
});

describe("поиск уже открытого разговора", () => {
  it("ИНВАРИАНТ: незакрытая заявка по той же услуге переиспользуется", async () => {
    /* Её человек и подавал кнопкой «Сотрудничество» — разговор по ней у него
       уже открыт, и вести его в новый чат значит начать заново. */
    prismaMock.appeal.findFirst.mockResolvedValue(row({ id: "coop1" }));
    prismaMock.appeal.findUnique.mockResolvedValue(row({ id: "coop1", subject: "Сотрудничество: Честный Знак", body: "Хочу заказать" }));

    const link = await ensureProjectConversation(PROJECT, "client");
    expect(link?.appealId).toBe("coop1");
    expect(prismaMock.appeal.create).not.toHaveBeenCalled();

    const where = (prismaMock.appeal.findFirst.mock.calls[0]![0] as {
      where: { authorId: string; category: string; subject: string; status: { not: string } };
    }).where;
    expect(where.authorId).toBe("client");
    expect(where.category).toBe("COOPERATION");
    expect(where.subject).toBe(cooperationSubject("Честный Знак"));
    /* Закрытая заявка — законченный разговор: дописывать в неё новую работу
       значит воскрешать то, что стороны сочли исчерпанным. */
    expect(where.status).toEqual({ not: "CLOSED" });
  });

  it("ФИКСАЦИЯ: связь запоминается в проекте", async () => {
    prismaMock.appeal.findFirst.mockResolvedValue(row({ id: "coop1" }));
    prismaMock.appeal.findUnique.mockResolvedValue(row({ id: "coop1", subject: "Тема", body: "Текст" }));
    await ensureProjectConversation(PROJECT, "client");
    expect(prismaMock.partnerProject.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { appealId: "coop1" },
    });
  });

  it("проект без услуги ищет не по услуге, а сразу заводит обращение", async () => {
    /* Искать «последнее обращение автора» нельзя: у него может висеть
       обжалование блокировки, и обсуждение работ ушло бы туда. */
    const link = await ensureProjectConversation({ ...PROJECT, service: null }, "client");
    expect(prismaMock.appeal.findFirst).not.toHaveBeenCalled();
    expect(link?.appealId).toBe("new-appeal");
  });
});

describe("новое обращение", () => {
  it("ИНВАРИАНТ: автором становится владелец проекта, а не открывший чат админ", async () => {
    /* В деловом разговоре первая сторона — заказчик, по этому порядку список
       понимает, кто из двоих клиент (см. lib/businessChat). */
    await ensureProjectConversation(PROJECT, "admin1");
    const data = (prismaMock.appeal.create.mock.calls[0]![0] as {
      data: { authorId: string; category: string; subject: string; channelId: string };
    }).data;
    expect(data.authorId).toBe("client");
    expect(data.category).toBe("COOPERATION");
    expect(data.subject).toBe("Проект: Маркировка обуви");
    expect(data.channelId).toBe("appeals-channel");
  });

  it("разбирающие узнают о новой заявке", async () => {
    await ensureProjectConversation(PROJECT, "admin1");
    expect(notifyNewAppeal).toHaveBeenCalledWith(expect.objectContaining({
      appealId: "new-appeal",
      actorId: "admin1",
      isBanAppeal: false,
    }));
  });

  it("канал обращений досоздаётся, если его нет", async () => {
    prismaMock.channel.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(row({ id: "созданный" }));
    const link = await ensureProjectConversation(PROJECT, "client");
    expect(ensureAppealsChannel).toHaveBeenCalled();
    expect(link?.appealId).toBe("new-appeal");
  });

  it("ИНВАРИАНТ: канала нет и создать не вышло — честный отказ, а не пустой успех", async () => {
    /* Снаружи это выглядит как «кнопка не работает», и маршрут обязан сказать
       человеку, что делать дальше. */
    prismaMock.channel.findFirst.mockResolvedValue(null as never);
    expect(await ensureProjectConversation(PROJECT, "client")).toBeNull();
    expect(prismaMock.appeal.create).not.toHaveBeenCalled();
  });

  it("некому вести разговор — обращение всё равно остаётся", async () => {
    /* В проекте нет ни одного администратора: разговора нет, но заявка подана и
       не должна исчезнуть вместе с неудачей. */
    ensureBusinessChat.mockResolvedValue(null);
    const link = await ensureProjectConversation(PROJECT, "client");
    expect(link).toEqual({ appealId: "new-appeal", conversationId: null });
  });
});
