/**
 * Тесты: src/lib/boardTemplates.ts — заготовки досок.
 *
 * Заготовка разворачивает полтора десятка карточек одним нажатием. Ошибка в
 * данных тут не падает, а тихо выдаёт кривую доску: карточки друг на друге,
 * связь в пустоту, задача без чек-листа. Разбирать это руками дольше, чем
 * собрать доску с нуля, — поэтому каталог проверяется целиком.
 */
import { describe, it, expect } from "vitest";
import {
  BOARD_TEMPLATES,
  SPHERE_ORDER,
  instantiateTemplate,
  isBoardEmpty,
  templateById,
  templatesBySphere,
} from "@/lib/boardTemplates";

let counter = 0;
const makeId = () => `id${++counter}`;

describe("каталог", () => {
  it("есть заготовки во всех трёх сферах", () => {
    /* Инструмент один и тот же, но показать это можно только примерами из
       разной жизни — иначе доска читается как «ещё один трекер для офиса». */
    for (const sphere of SPHERE_ORDER) {
      expect(templatesBySphere(sphere).length, sphere).toBeGreaterThanOrEqual(3);
    }
    expect(BOARD_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it("ИНВАРИАНТ: идентификаторы не повторяются", () => {
    /* По идентификатору заготовка ищется при развёртывании: дубль означал бы,
       что вместо выбранной разворачивается соседняя. */
    const ids = BOARD_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ИНВАРИАНТ: в заготовке нет двух карточек в одной клетке", () => {
    /* Иначе они лягут ровно друг на друга, и нижнюю не найти. */
    for (const template of BOARD_TEMPLATES) {
      const cells = template.cards.map((c) => `${c.col}:${c.row}`);
      expect(new Set(cells).size, template.id).toBe(cells.length);
    }
  });

  it("ИНВАРИАНТ: связи ведут в существующие карточки", () => {
    for (const template of BOARD_TEMPLATES) {
      for (const [from, to] of template.edges ?? []) {
        expect(template.cards[from], `${template.id}:${from}`).toBeDefined();
        expect(template.cards[to], `${template.id}:${to}`).toBeDefined();
        expect(from, template.id).not.toBe(to);
      }
    }
  });

  it("каждая заготовка названа и описана", () => {
    for (const template of BOARD_TEMPLATES) {
      expect(template.name.length, template.id).toBeGreaterThan(2);
      expect(template.summary.length, template.id).toBeGreaterThan(10);
      expect(template.cards.length, template.id).toBeGreaterThanOrEqual(4);
    }
  });

  it("ФИКСАЦИЯ: каркас заполнен, а не пуст", () => {
    /* Пустой каркас пришлось бы заполнять — то есть решать ровно ту задачу,
       ради которой заготовку и берут. */
    for (const template of BOARD_TEMPLATES) {
      const filled = template.cards.filter(
        (c) => (c.checklist?.length ?? 0) > 0 || (c.body?.length ?? 0) > 0 || (c.cells?.length ?? 0) > 0 || !!c.text,
      );
      expect(filled.length, template.id).toBe(template.cards.length);
    }
  });

  it("поиск по идентификатору находит и не выдумывает", () => {
    expect(templateById("launch")?.sphere).toBe("work");
    expect(templateById("нет такого")).toBeNull();
  });
});

describe("только на пустую доску", () => {
  it("пустая — можно, с карточкой или связью — нельзя", () => {
    /* Поверх существующей работы заготовка — это месиво: чужие карточки
       вперемешку со своими, и разобрать их обратно нечем. */
    expect(isBoardEmpty([], [])).toBe(true);
    expect(isBoardEmpty([{}], [])).toBe(false);
    expect(isBoardEmpty([], [{}])).toBe(false);
  });
});

describe("развёртывание", () => {
  const template = templateById("hiring")!;

  it("карточки получают свои идентификаторы и место", () => {
    const built = instantiateTemplate(template, makeId, { x: 100, y: 50 }, 1000);
    expect(built.cards).toHaveLength(template.cards.length);
    expect(new Set(built.cards.map((c) => c.id)).size).toBe(built.cards.length);
    expect(built.cards[0]).toMatchObject({ x: 100, y: 50, createdAt: 1000 });
    expect(built.cards.every((c) => c.x >= 100 && c.y >= 50)).toBe(true);
  });

  it("ИНВАРИАНТ: связи ссылаются на карточки этой же доски", () => {
    /* Связь на чужой или несуществующий узел рисуется в пустоту. */
    const built = instantiateTemplate(template, makeId, { x: 0, y: 0 });
    const ids = new Set(built.cards.map((c) => c.id));
    for (const edge of built.edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });

  it("задача разворачивается с готовым чек-листом", () => {
    const built = instantiateTemplate(template, makeId, { x: 0, y: 0 });
    const task = built.cards.find((c) => c.type === "task")!;
    expect(task).toMatchObject({ status: "todo", progress: 0, deadline: "" });
    expect((task.checklist as { text: string; done: boolean }[]).length).toBeGreaterThan(0);
    expect((task.checklist as { done: boolean }[]).every((i) => i.done === false)).toBe(true);
  });

  it("таблица разворачивается с заголовком", () => {
    const built = instantiateTemplate(template, makeId, { x: 0, y: 0 });
    const table = built.cards.find((c) => c.type === "table")!;
    expect(table.hasHeader).toBe(true);
    expect((table.cells as string[][])[0]!.length).toBeGreaterThan(1);
  });

  it("ФИКСАЦИЯ: две развёртки не делят один объект", () => {
    /* Таблицы копируются построчно. Отдай мы ту же ссылку — правка в одной
       доске меняла бы вторую, а с ней и сам каталог заготовок. */
    const first = instantiateTemplate(template, makeId, { x: 0, y: 0 });
    const second = instantiateTemplate(template, makeId, { x: 0, y: 0 });
    const a = first.cards.find((c) => c.type === "table")!.cells as string[][];
    const b = second.cards.find((c) => c.type === "table")!.cells as string[][];
    a[0]![0] = "испорчено";
    expect(b[0]![0]).not.toBe("испорчено");
    expect(templateById("hiring")!.cards.find((c) => c.kind === "table")!.cells![0]![0]).not.toBe("испорчено");
  });

  it("все заготовки разворачиваются без ошибок", () => {
    for (const item of BOARD_TEMPLATES) {
      const built = instantiateTemplate(item, makeId, { x: 0, y: 0 });
      expect(built.cards.length, item.id).toBe(item.cards.length);
      expect(built.cards.every((c) => typeof c.title === "string" && c.title.length > 0), item.id).toBe(true);
    }
  });
});
