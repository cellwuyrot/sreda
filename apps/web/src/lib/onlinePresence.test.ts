/**
 * Тесты: src/lib/onlinePresence.ts — слияние присутствия со списком участников.
 *
 * Баг, из-за которого это появилось: отметки присутствия в списке участников
 * замирали на моменте открытия группы. Снимок сообщества больше не
 * перезапрашивался, поэтому зашедший позже так и оставался «был 3 дня назад», а
 * бывший в сети через минуту гас навсегда — его `lastSeen` просто старел. Пока не
 * выйдешь из группы и не зайдёшь заново, ничего не менялось.
 */
import { describe, it, expect } from "vitest";
import { mergePresence, presenceSince, type OnlinePresence } from "@/lib/onlinePresence";
import { isOnline, ONLINE_WINDOW_MS } from "@/lib/timeAgo";

const OLD = "2026-07-29T10:00:00.000Z";

function rows() {
  return [
    { role: "OWNER", user: { id: "u1", lastSeen: OLD } },
    { role: "MEMBER", user: { id: "u2", lastSeen: null } },
    { role: "MEMBER", user: { id: "u3", lastSeen: OLD } },
  ];
}

describe("mergePresence", () => {
  /**
   * ИНВАРИАНТ: тот, кто зашёл в сеть после открытия группы, должен появиться в
   * сети без перезахода в группу. Это и есть сам баг.
   */
  it("ИНВАРИАНТ: присутствующий получает свежую отметку", () => {
    const at = new Date().toISOString();
    const merged = mergePresence(rows(), { online: ["u2"], at });
    const u2 = merged.find((m) => m.user.id === "u2")!;
    expect(u2.user.lastSeen).toBe(at);
    expect(isOnline(u2.user.lastSeen)).toBe(true);
  });

  it("отсутствующих не трогаем: их отметка устареет сама", () => {
    const merged = mergePresence(rows(), { online: ["u2"], at: new Date().toISOString() });
    expect(merged.find((m) => m.user.id === "u1")!.user.lastSeen).toBe(OLD);
    expect(merged.find((m) => m.user.id === "u3")!.user.lastSeen).toBe(OLD);
  });

  /**
   * ИНВАРИАНТ: «вышел из сети» работает без единого лишнего байта. Сервер
   * присылает только присутствующих; кого нет — гаснет, потому что его отметка
   * старше окна присутствия.
   */
  it("ИНВАРИАНТ: пропавший из ответа считается не в сети", () => {
    const at = new Date().toISOString();
    const first = mergePresence(rows(), { online: ["u1"], at });
    expect(isOnline(first.find((m) => m.user.id === "u1")!.user.lastSeen)).toBe(true);

    /* Следующий ответ пришёл без u1 — и его отметка уже вне окна. */
    const staleAt = new Date(Date.now() - ONLINE_WINDOW_MS - 1000).toISOString();
    const aged = first.map((m) => (m.user.id === "u1" ? { ...m, user: { ...m.user, lastSeen: staleAt } } : m));
    const second = mergePresence(aged, { online: ["u2"], at: new Date().toISOString() });
    expect(isOnline(second.find((m) => m.user.id === "u1")!.user.lastSeen)).toBe(false);
  });

  it("пустой ответ ничего не портит", () => {
    const merged = mergePresence(rows(), { online: [], at: new Date().toISOString() });
    expect(merged.map((m) => m.user.lastSeen)).toEqual([OLD, null, OLD]);
  });

  it("без ответа список остаётся как был", () => {
    const merged = mergePresence(rows(), null);
    expect(merged).toHaveLength(3);
    expect(merged[0].user.lastSeen).toBe(OLD);
  });

  it("неизвестные идентификаторы в ответе не создают участников", () => {
    const merged = mergePresence(rows(), { online: ["u9", "u2"], at: new Date().toISOString() });
    expect(merged).toHaveLength(3);
    expect(merged.map((m) => m.user.id)).toEqual(["u1", "u2", "u3"]);
  });

  /**
   * ИНВАРИАНТ: строки без изменений остаются ТЕМИ ЖЕ ссылками. Слияние идёт раз в
   * полминуты, и пересборка всех элементов заставляла бы список перерисовываться
   * целиком — прямо под пальцем у человека, который его читает.
   */
  it("ИНВАРИАНТ: неизменившиеся строки не пересобираются", () => {
    const source = rows();
    const merged = mergePresence(source, { online: ["u2"], at: new Date().toISOString() });
    expect(merged[0]).toBe(source[0]);
    expect(merged[2]).toBe(source[2]);
    expect(merged[1]).not.toBe(source[1]);
  });

  it("повторное слияние с тем же ответом ничего не пересобирает", () => {
    const presence: OnlinePresence = { online: ["u2"], at: new Date().toISOString() };
    const once = mergePresence(rows(), presence);
    const twice = mergePresence(once, presence);
    expect(twice[1]).toBe(once[1]);
  });

  it("исходный список не меняется на месте", () => {
    const source = rows();
    mergePresence(source, { online: ["u2"], at: new Date().toISOString() });
    expect(source[1].user.lastSeen).toBeNull();
  });
});

describe("presenceSince", () => {
  it("граница отстоит от текущего момента на окно присутствия", () => {
    const now = Date.UTC(2026, 7, 1, 12, 0, 0);
    expect(presenceSince(now).getTime()).toBe(now - ONLINE_WINDOW_MS);
  });

  /**
   * ИНВАРИАНТ: сервер и клиент считают присутствие по одному окну. Разойдись
   * они — один экран показывал бы человека в сети, а другой уже нет.
   */
  it("ИНВАРИАНТ: окно то же, по которому клиент считает «в сети»", () => {
    const now = Date.now();
    const border = presenceSince(now);
    expect(isOnline(new Date(border.getTime() + 500))).toBe(true);
    expect(isOnline(new Date(border.getTime() - 500))).toBe(false);
  });
});
