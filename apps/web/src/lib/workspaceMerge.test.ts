/**
 * Тесты: src/lib/workspaceMerge.ts — слияние правок рабочей среды.
 *
 * Зачем правка. Состояние сохраняется целым снимком, и при известии «состояние
 * изменилось» клиент заменял своё пришедшим ЦЕЛИКОМ. Всё, что человек успел
 * сделать за последние секунды, исчезало без следа и без сообщения. На общем
 * холсте канала это происходило при каждой правке соседа.
 *
 * Здесь закрепляется то, ради чего всё затевалось: **чужой снимок не стирает
 * мои изменения**. И отдельно — сознательный выбор в спорном случае: правка
 * побеждает удаление, потому что лишнюю карточку убрать легко, а потерянную
 * работу не вернуть ничем.
 */
import { describe, it, expect } from "vitest";
import { diffDirtyIds, mergeBoards, type MergeableBoard } from "@/lib/workspaceMerge";

function card(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: id, x: 0, y: 0, ...extra };
}
function edge(id: string, from: string, to: string) {
  return { id, from, to };
}
function board(id: string, cards: ReturnType<typeof card>[], edges: ReturnType<typeof edge>[] = []): MergeableBoard {
  return { id, name: id, cards, edges };
}

describe("что считается моими изменениями", () => {
  it("нетронутое состояние не даёт изменений", () => {
    const b = [board("b1", [card("a"), card("b")])];
    expect(diffDirtyIds(b, b).size).toBe(0);
  });

  it("сдвинутая и новая карточка попадают в изменённые", () => {
    const before = [board("b1", [card("a"), card("b")])];
    const after = [board("b1", [card("a", { x: 40 }), card("b"), card("новая")])];
    expect([...diffDirtyIds(before, after)].sort()).toEqual(["a", "новая"]);
  });

  it("ФИКСАЦИЯ: удалённое мною в изменения не попадает", () => {
    /* Удаление уедет обычным сохранением. Вносить его в слияние опасно: чужая
       правка той же карточки должна её сохранить, а не дать удалить. */
    const before = [board("b1", [card("a"), card("b")])];
    const after = [board("b1", [card("a")])];
    expect(diffDirtyIds(before, after).has("b")).toBe(false);
  });

  it("изменённая связь тоже считается", () => {
    const before = [board("b1", [card("a"), card("b")], [edge("e1", "a", "b")])];
    const after = [board("b1", [card("a"), card("b")], [edge("e1", "b", "a")])];
    expect(diffDirtyIds(before, after).has("e1")).toBe(true);
  });
});

describe("слияние", () => {
  it("нечего сливать — берём пришедшее как есть", () => {
    const incoming = [board("b1", [card("a")])];
    expect(mergeBoards(incoming, [board("b1", [card("a")])], new Set())).toBe(incoming);
  });

  it("ИНВАРИАНТ: моя правка переживает чужой снимок", () => {
    /* Ровно та потеря, из-за которой всё затевалось: я двигаю карточку, сосед
       сохраняется, и раньше мой сдвиг исчезал. */
    const incoming = [board("b1", [card("a"), card("сосед")])];
    const local = [board("b1", [card("a", { x: 999 })])];
    const merged = mergeBoards(incoming, local, new Set(["a"]));

    const cards = merged[0]!.cards;
    expect(cards.find((c) => c.id === "a")).toMatchObject({ x: 999 });
    // И чужая карточка при этом не пропала.
    expect(cards.some((c) => c.id === "сосед")).toBe(true);
  });

  it("чего я не трогал — беру с сервера, включая чужие удаления", () => {
    const incoming = [board("b1", [card("a")])];
    const local = [board("b1", [card("a"), card("удалена-соседом")])];
    const merged = mergeBoards(incoming, local, new Set(["a"]));
    expect(merged[0]!.cards.map((c) => c.id)).toEqual(["a"]);
  });

  it("ФИКСАЦИЯ: правка побеждает удаление", () => {
    /* Сосед удалил карточку, пока я её правил. Оставляем: вернуть лишнюю
       карточку — одно движение, восстановить потерянную работу нельзя. */
    const incoming = [board("b1", [card("сосед")])];
    const local = [board("b1", [card("сосед"), card("моя", { title: "правил" })])];
    const merged = mergeBoards(incoming, local, new Set(["моя"]));
    expect(merged[0]!.cards.some((c) => c.id === "моя")).toBe(true);
  });

  it("моя новая карточка добавляется, а не теряется", () => {
    const incoming = [board("b1", [card("a")])];
    const local = [board("b1", [card("a"), card("только-что-создал")])];
    const merged = mergeBoards(incoming, local, new Set(["только-что-создал"]));
    expect(merged[0]!.cards.map((c) => c.id)).toEqual(["a", "только-что-создал"]);
  });

  it("холст, удалённый соседом, остаётся, если на нём мои свежие правки", () => {
    const incoming = [board("b1", [card("a")])];
    const local = [board("b1", [card("a")]), board("b2", [card("моя")])];
    const merged = mergeBoards(incoming, local, new Set(["моя"]));
    expect(merged.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("нетронутый холст, удалённый соседом, не возвращается", () => {
    /* Иначе удалить холст стало бы невозможно: он воскресал бы у каждого, у
       кого открыт. */
    const incoming = [board("b1", [card("a")])];
    const local = [board("b1", [card("a")]), board("b2", [card("чужая")])];
    const merged = mergeBoards(incoming, local, new Set(["a"]));
    expect(merged.map((b) => b.id)).toEqual(["b1"]);
  });

  it("ФИКСАЦИЯ: связь без обоих концов не остаётся висеть", () => {
    /* Линия в пустоту — это не «почти правильно», это мусор на экране. */
    const incoming = [board("b1", [card("a")], [edge("e1", "a", "b")])];
    const merged = mergeBoards(incoming, [board("b1", [card("a")])], new Set(["a"]));
    expect(merged[0]!.edges).toEqual([]);
  });

  it("моя связь переживает слияние, если оба конца на месте", () => {
    const incoming = [board("b1", [card("a"), card("b")], [])];
    const local = [board("b1", [card("a"), card("b")], [edge("e1", "a", "b")])];
    const merged = mergeBoards(incoming, local, new Set(["e1"]));
    expect(merged[0]!.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("исходные состояния не меняются на месте", () => {
    const incoming = [board("b1", [card("a")])];
    const local = [board("b1", [card("a", { x: 5 })])];
    mergeBoards(incoming, local, new Set(["a"]));
    expect(incoming[0]!.cards[0]).toMatchObject({ x: 0 });
  });
});
