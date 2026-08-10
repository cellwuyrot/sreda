/**
 * Тесты: src/lib/businessChat.ts
 * Проверяем разбор категорий и вида разговора, выбор стороны администрации,
 * создание чата при подаче обращения и перенос ответа из карточки в чат.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/test/prismaMock";
import { row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import {
  isBusinessAppeal,
  isConversationKind,
  isStaffRole,
  staffIds,
  administrationSlotId,
  ensureBusinessChat,
  mirrorAppealMessage,
} from "@/lib/businessChat";

beforeEach(() => {
  warn.mockClear();
});

/* Модуль пишет в журнал, когда вести чат некому. В выводе тестов это шум, а
   само сообщение проверяется отдельным ожиданием. */
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

// ─── isBusinessAppeal ──────────────────────────────────────────────────────────

describe("isBusinessAppeal", () => {
  it('«COOPERATION» открывает деловой чат', () => {
    expect(isBusinessAppeal("COOPERATION")).toBe(true);
  });

  it("null не открывает чат", () => {
    expect(isBusinessAppeal(null)).toBe(false);
  });

  it("undefined не открывает чат", () => {
    expect(isBusinessAppeal(undefined)).toBe(false);
  });

  it("пустая строка не открывает чат", () => {
    expect(isBusinessAppeal("")).toBe(false);
  });

  it("произвольная строка не открывает чат", () => {
    expect(isBusinessAppeal("SOME_OTHER")).toBe(false);
  });

  /**
   * ИНВАРИАНТ: обжалование блокировки не должно открывать деловой чат —
   * заблокированному пользователю нельзя давать обходной канал связи с
   * администратором через раздел «Бизнес».
   */
  it("ИНВАРИАНТ: BAN_APPEAL НЕ получает деловой чат", () => {
    expect(isBusinessAppeal("BAN_APPEAL")).toBe(false);
  });

  it("BAN_APPEAL с суффиксом тоже не открывает чат", () => {
    expect(isBusinessAppeal("BAN_APPEAL:some_extra")).toBe(false);
  });
});

// ─── isConversationKind ────────────────────────────────────────────────────────

describe("isConversationKind", () => {
  it('«PERSONAL» принимается', () => {
    expect(isConversationKind("PERSONAL")).toBe(true);
  });

  it('«BUSINESS» принимается', () => {
    expect(isConversationKind("BUSINESS")).toBe(true);
  });

  it("мусорная строка отвергается", () => {
    expect(isConversationKind("мусор")).toBe(false);
  });

  it("пустая строка отвергается", () => {
    expect(isConversationKind("")).toBe(false);
  });

  it("число отвергается", () => {
    expect(isConversationKind(42)).toBe(false);
  });

  it("null отвергается", () => {
    expect(isConversationKind(null)).toBe(false);
  });

  it("undefined отвергается", () => {
    expect(isConversationKind(undefined)).toBe(false);
  });

  it("объект отвергается", () => {
    expect(isConversationKind({ kind: "PERSONAL" })).toBe(false);
  });
});


// ─── isStaffRole ───────────────────────────────────────────────────────────────

describe("isStaffRole", () => {
  it("ADMIN — администрация", () => {
    expect(isStaffRole("ADMIN")).toBe(true);
  });

  it("EDITOR — тоже администрация: заявки разбирает и он", () => {
    expect(isStaffRole("EDITOR")).toBe(true);
  });

  it("USER — нет", () => {
    expect(isStaffRole("USER")).toBe(false);
  });

  it("null и undefined — нет", () => {
    expect(isStaffRole(null)).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });

  it("регистр важен: «admin» не роль", () => {
    expect(isStaffRole("admin")).toBe(false);
  });
});

// ─── staffIds ──────────────────────────────────────────────────────────────────

describe("staffIds", () => {
  it("спрашивает обе роли администрации", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await staffIds();
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: { in: ["ADMIN", "EDITOR"] } }),
      })
    );
  });

  it("исключает указанного человека — обычно это сам автор действия", async () => {
    prismaMock.user.findMany.mockResolvedValue(
      row([{ id: "admin-1" }, { id: "editor-1" }])
    );
    expect(await staffIds("admin-1")).toEqual(["editor-1"]);
  });
});

// ─── administrationSlotId ──────────────────────────────────────────────────────

describe("administrationSlotId", () => {
  it("предпочитает ADMIN, даже если редактор в выдаче раньше", async () => {
    prismaMock.user.findMany.mockResolvedValue(
      row([{ id: "editor-1", role: "EDITOR" }, { id: "admin-1", role: "ADMIN" }])
    );
    expect(await administrationSlotId("client-1")).toBe("admin-1");
  });

  it("без администратора берёт редактора", async () => {
    prismaMock.user.findMany.mockResolvedValue(row([{ id: "editor-1", role: "EDITOR" }]));
    expect(await administrationSlotId("client-1")).toBe("editor-1");
  });

  /**
   * ИНВАРИАНТ: администратор, подавший заявку от себя, не может занять и место
   * администрации — разговор с самим собой в разделе ЛС занят «Сейфом», и такой
   * чат читался бы как ошибка.
   */
  it("ИНВАРИАНТ: сам заявитель стороной администрации не становится", async () => {
    prismaMock.user.findMany.mockResolvedValue(
      row([{ id: "admin-1", role: "ADMIN" }, { id: "editor-1", role: "EDITOR" }])
    );
    expect(await administrationSlotId("admin-1")).toBe("editor-1");
  });

  it("если кроме заявителя никого нет — null", async () => {
    prismaMock.user.findMany.mockResolvedValue(row([{ id: "admin-1", role: "ADMIN" }]));
    expect(await administrationSlotId("admin-1")).toBeNull();
  });
});

// ─── ensureBusinessChat ────────────────────────────────────────────────────────

const BASE_PARAMS = {
  appealId: "appeal-1",
  clientId: "user-client",
  subject: "Сотрудничество",
  appealBody: "Хочу продвигать ваш продукт",
};

/** Стандартная администрация для тестов создания чата. */
function staffFound(list: Array<{ id: string; role: string }> = [{ id: "admin-1", role: "ADMIN" }]) {
  prismaMock.user.findMany.mockResolvedValue(row(list));
}

describe("ensureBusinessChat", () => {
  it("возвращает id существующего разговора и не создаёт второй", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(row({ id: "conv-existing" }));

    const result = await ensureBusinessChat(BASE_PARAMS);

    expect(result).toBe("conv-existing");
    expect(prismaMock.directConversation.create).not.toHaveBeenCalled();
  });

  it("ищет разговор по обращению: одно обращение — один чат", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(row({ id: "conv-1" }));

    await ensureBusinessChat(BASE_PARAMS);

    expect(prismaMock.directConversation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { appealId: "appeal-1" } })
    );
  });

  it("создаёт разговор с kind=BUSINESS и обращением", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(null);
    staffFound();
    prismaMock.directConversation.create.mockResolvedValue(row({ id: "conv-new" }));

    const result = await ensureBusinessChat(BASE_PARAMS);

    expect(result).toBe("conv-new");
    expect(prismaMock.directConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "BUSINESS", appealId: "appeal-1" }),
      })
    );
  });

  /**
   * ИНВАРИАНТ: клиент — всегда user1. Пару НЕ сортируем: по этому порядку список
   * деловых разговоров понимает, кто из двоих заказчик. Раньше пара сортировалась
   * по id, и клиент мог оказаться вторым — тогда в собеседниках он увидел бы
   * собственное имя.
   */
  it("ИНВАРИАНТ: клиент попадает в user1Id, даже если его id лексически больше", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(null);
    staffFound([{ id: "admin-aaa", role: "ADMIN" }]);
    prismaMock.directConversation.create.mockResolvedValue(row({ id: "conv-order" }));

    await ensureBusinessChat({ ...BASE_PARAMS, clientId: "zzz-client" });

    expect(prismaMock.directConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user1Id: "zzz-client", user2Id: "admin-aaa" }),
      })
    );
  });

  it("в новый чат кладётся одно сообщение — сама заявка от клиента", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(null);
    staffFound();
    prismaMock.directConversation.create.mockResolvedValue(row({ id: "conv-msg" }));

    await ensureBusinessChat(BASE_PARAMS);

    const createCall = prismaMock.directConversation.create.mock.calls[0][0];
    const messages = (createCall as { data: { messages: { create: Array<{ userId: string; content: string }> } } })
      .data.messages.create;
    expect(messages).toHaveLength(1);
    expect(messages[0].userId).toBe(BASE_PARAMS.clientId);
    expect(messages[0].content).toContain(BASE_PARAMS.subject);
    expect(messages[0].content).toContain(BASE_PARAMS.appealBody);
  });

  it("некому вести — null и запись в журнал, а не тихая пустота", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValue(null);
    staffFound([]);

    expect(await ensureBusinessChat(BASE_PARAMS)).toBeNull();
    expect(prismaMock.directConversation.create).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("при гонке (create бросает) возвращает id уже созданного разговора", async () => {
    prismaMock.directConversation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({ id: "conv-raced" }));
    staffFound();
    prismaMock.directConversation.create.mockRejectedValue(new Error("Unique constraint failed"));

    expect(await ensureBusinessChat(BASE_PARAMS)).toBe("conv-raced");
  });

  it("при гонке, если повторный поиск тоже пуст — null, не падение", async () => {
    prismaMock.directConversation.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    staffFound();
    prismaMock.directConversation.create.mockRejectedValue(new Error("Unique constraint failed"));

    expect(await ensureBusinessChat(BASE_PARAMS)).toBeNull();
  });
});

// ─── mirrorAppealMessage ───────────────────────────────────────────────────────

const APPEAL = {
  id: "appeal-1",
  authorId: "client-1",
  subject: "Сотрудничество",
  body: "Текст заявки",
  category: "COOPERATION",
};

/** Разговор уже есть: настраиваем два разных findUnique — по обращению и по id. */
function chatFound(handlerId: string | null) {
  prismaMock.directConversation.findUnique
    .mockResolvedValueOnce(row({ id: "conv-1" }))
    .mockResolvedValueOnce(row({ id: "conv-1", user1Id: "client-1", user2Id: "admin-1", handlerId }));
  prismaMock.directMessage.create.mockResolvedValue(
    row({
      id: "dm-1",
      content: "текст",
      userId: "admin-1",
      createdAt: new Date("2026-08-01T10:00:00Z"),
      user: { id: "admin-1", name: "Админ", username: "admin", avatar: null, role: "ADMIN" },
    })
  );
  prismaMock.directConversation.update.mockResolvedValue(row({ id: "conv-1" }));
  prismaMock.user.findMany.mockResolvedValue(row([{ id: "admin-1" }, { id: "editor-1" }]));
}

describe("mirrorAppealMessage", () => {
  /**
   * ИНВАРИАНТ: обжалование блокировки делового чата не получает — иначе у
   * заблокированного появляется канал связи в обход блокировки.
   */
  it("ИНВАРИАНТ: не деловое обращение не переносится и базу не трогает", async () => {
    const result = await mirrorAppealMessage({
      appeal: { ...APPEAL, category: "BAN_APPEAL:cycle" },
      authorId: "admin-1",
      body: "ответ",
      fromStaff: true,
    });

    expect(result).toBeNull();
    expect(prismaMock.directConversation.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.directMessage.create).not.toHaveBeenCalled();
  });

  it("первый ответ из администрации назначает ведущего", async () => {
    chatFound(null);

    const result = await mirrorAppealMessage({
      appeal: APPEAL,
      authorId: "admin-1",
      body: "Здравствуйте",
      fromStaff: true,
    });

    expect(result?.handlerId).toBe("admin-1");
    expect(prismaMock.directConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "conv-1" }, data: { handlerId: "admin-1" } })
    );
  });

  it("если заявку уже ведут — ведущий не переназначается", async () => {
    chatFound("editor-1");

    const result = await mirrorAppealMessage({
      appeal: APPEAL,
      authorId: "admin-1",
      body: "И от меня",
      fromStaff: true,
    });

    expect(result?.handlerId).toBe("editor-1");
    expect(prismaMock.directConversation.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { handlerId: "admin-1" } })
    );
  });

  it("сообщение клиента ведущего не назначает: клиент заявку не берёт", async () => {
    chatFound(null);

    const result = await mirrorAppealMessage({
      appeal: APPEAL,
      authorId: "client-1",
      body: "Дополню",
      fromStaff: false,
    });

    expect(result?.handlerId).toBeNull();
  });

  it("сообщение пишется в разговор от имени автора", async () => {
    chatFound("admin-1");

    await mirrorAppealMessage({
      appeal: APPEAL,
      authorId: "admin-1",
      body: "Готовы обсудить",
      fromStaff: true,
    });

    expect(prismaMock.directMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { conversationId: "conv-1", userId: "admin-1", content: "Готовы обсудить" },
      })
    );
  });

  it("адресаты события — клиент и вся администрация, без повторов", async () => {
    chatFound("admin-1");

    const result = await mirrorAppealMessage({
      appeal: APPEAL,
      authorId: "admin-1",
      body: "ответ",
      fromStaff: true,
    });

    expect(result?.recipients).toEqual(["client-1", "admin-1", "editor-1"]);
  });
});
