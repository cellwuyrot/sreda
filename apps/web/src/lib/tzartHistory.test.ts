/**
 * Тесты: src/lib/tzartHistory.ts — отмена и повтор в TZartstation.
 *
 * Отмена ломается тремя способами, и каждый выглядит как «кнопка не работает»:
 * повтор возвращает состояние из другой ветки работы, история набивается
 * пустыми шагами, память вкладки растёт без предела.
 */
import { describe, it, expect } from "vitest";
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  commit,
  commitFrom,
  initHistory,
  redo,
  reset,
  undo,
} from "@/lib/tzartHistory";

describe("шаг назад и вперёд", () => {
  it("возвращает предыдущее состояние и снова текущее", () => {
    const history = commit(commit(initHistory("а"), "б"), "в");
    expect(history.present).toBe("в");
    const back = undo(history);
    expect(back.present).toBe("б");
    expect(redo(back).present).toBe("в");
  });

  it("на пустой истории ничего не происходит", () => {
    const history = initHistory("а");
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it("ИНВАРИАНТ: новое действие стирает «вперёд»", () => {
    /* Иначе после отмены и правки кнопка «вернуть» вернула бы состояние из
       другой ветки работы — то, чего человек никогда не видел. */
    const branched = commit(undo(commit(commit(initHistory("а"), "б"), "в")), "другое");
    expect(branched.present).toBe("другое");
    expect(canRedo(branched)).toBe(false);
    expect(undo(branched).present).toBe("б");
  });

  it("ФИКСАЦИЯ: одинаковые состояния подряд в историю не идут", () => {
    /* Перетаскивание объекта на место и обратно, щелчок по уже выбранному
       цвету — иначе «отменить» переставало бы работать с первого нажатия. */
    const history = commit(initHistory("а"), "б");
    expect(commit(history, "б")).toBe(history);
  });

  it("сравнение можно задать своё", () => {
    /* Сцена, пересобранная при перерисовке, — это не действие человека. */
    const same = (a: { v: number }, b: { v: number }) => a.v === b.v;
    const history = initHistory({ v: 1 });
    expect(commit(history, { v: 1 }, same)).toBe(history);
    expect(commit(history, { v: 2 }, same).present).toEqual({ v: 2 });
  });

  it("ФИКСАЦИЯ: глубина истории ограничена", () => {
    /* Память вкладки не бесконечна, а дальше нескольких десятков шагов назад
       никто не возвращается. */
    let history = initHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) history = commit(history, i);
    expect(history.past.length).toBe(HISTORY_LIMIT);
    expect(history.present).toBe(HISTORY_LIMIT + 20);
  });
});

describe("длящаяся правка", () => {
  it("ИНВАРИАНТ: проход ползунка отменяется одним нажатием", () => {
    /* Живые значения кладутся мимо истории, а в конце шаг записывается от того
       состояния, что было до начала правки. Иначе «отменить» пришлось бы жать
       сорок раз. */
    const start = commit(initHistory("а"), "б");
    let live = start;
    for (const value of ["б1", "б2", "б3"]) live = reset(live, value);
    const closed = commitFrom(live, start.present);
    expect(closed.present).toBe("б3");
    expect(undo(closed).present).toBe("б");
  });

  it("правка, вернувшаяся к исходному, шага не создаёт", () => {
    const start = commit(initHistory("а"), "б");
    expect(commitFrom(reset(start, "б"), "б")).toEqual(start);
  });
});

describe("приход состояния извне", () => {
  it("ИНВАРИАНТ: чужая правка не становится моим шагом отмены", () => {
    /* На общем холсте состояние обновляет другой участник. Попади это в мою
       историю — «отменить» отменяло бы чужую работу. */
    const history = commit(initHistory("моё"), "моё-2");
    const outside = reset(history, "чужое");
    expect(outside.present).toBe("чужое");
    expect(outside.past).toEqual(history.past);
    expect(canRedo(outside)).toBe(false);
  });
});
