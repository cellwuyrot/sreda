/**
 * Тесты: src/lib/workspaceHistory.ts — снимки рабочей среды.
 *
 * Отмена живёт только в текущей вкладке, истории версий не было вовсе, а холст
 * можно потерять целиком. Снимки — страховка; и у неё есть два способа стать
 * бесполезной, оба проверяются здесь.
 *
 * Первый: снимать слишком часто. Среда сохраняется раз в 1,2 секунды при
 * активной работе — снимок на каждое сохранение дал бы три тысячи копий холста
 * за час.
 *
 * Второй, и он хуже: сохранить как снимок пустое состояние. Человек открывает
 * историю, возвращается «на час назад» — и получает чистый холст вместо работы.
 */
import { describe, it, expect } from "vitest";
import {
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_KEEP,
  channelOwnerKey,
  isSnapshotWorthy,
  personalOwnerKey,
  shouldSnapshot,
  snapshotsToDrop,
  summarize,
} from "@/lib/workspaceHistory";

const NOW = new Date("2026-08-02T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms);

describe("когда делать снимок", () => {
  it("снимков ещё нет — делаем сразу", () => {
    /* Первый снимок спасает от «сломал всё в первый же день», когда истории
       ещё нет и восстанавливать нечем. */
    expect(shouldSnapshot(null, NOW)).toBe(true);
  });

  it("ФИКСАЦИЯ: сразу после снимка второй не делаем", () => {
    expect(shouldSnapshot(ago(1000), NOW)).toBe(false);
    expect(shouldSnapshot(ago(SNAPSHOT_INTERVAL_MS - 1), NOW)).toBe(false);
  });

  it("интервал прошёл — снимаем", () => {
    expect(shouldSnapshot(ago(SNAPSHOT_INTERVAL_MS), NOW)).toBe(true);
    expect(shouldSnapshot(ago(SNAPSHOT_INTERVAL_MS * 3), NOW)).toBe(true);
  });
});

describe("что удалять", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));

  it("пока снимков немного — не удаляем ничего", () => {
    expect(snapshotsToDrop(rows(SNAPSHOT_KEEP))).toEqual([]);
    expect(snapshotsToDrop(rows(3))).toEqual([]);
  });

  it("ФИКСАЦИЯ: лишними считаются самые старые, а не самые новые", () => {
    /* Список приходит от новых к старым. Перепутать порядок значит удалить
       ровно то, ради чего всё затевалось. */
    const drop = snapshotsToDrop(rows(SNAPSHOT_KEEP + 3));
    expect(drop).toEqual([`s${SNAPSHOT_KEEP}`, `s${SNAPSHOT_KEEP + 1}`, `s${SNAPSHOT_KEEP + 2}`]);
  });
});

describe("что достойно снимка", () => {
  const withCards = JSON.stringify({ v: 3, boards: [{ id: "b1", cards: [{ id: "a" }], edges: [] }] });

  it("состояние с карточками — да", () => {
    expect(isSnapshotWorthy(withCards)).toBe(true);
  });

  it("ИНВАРИАНТ: пустой холст снимком не становится", () => {
    /* Иначе возврат «на час назад» отдаст человеку чистый лист вместо работы —
       страховка, которая уничтожает то, что должна беречь. */
    expect(isSnapshotWorthy(JSON.stringify({ v: 3, boards: [{ id: "b1", cards: [], edges: [] }] }))).toBe(false);
    expect(isSnapshotWorthy(JSON.stringify({ v: 3, boards: [] }))).toBe(false);
  });

  it("мусор вместо состояния не роняет проверку", () => {
    for (const bad of ["", "{", "не json", "null", "[]"]) {
      expect(isSnapshotWorthy(bad), bad).toBe(false);
    }
  });
});

describe("ключ владельца", () => {
  it("личная среда и общий холст не пересекаются", () => {
    /* Один ключ на оба режима: перепутать их значило бы показать человеку чужую
       историю — или подсунуть личный холст в канал. */
    expect(personalOwnerKey("u1")).toBe("u1");
    expect(channelOwnerKey("u1")).toBe("channel:u1");
    expect(personalOwnerKey("u1")).not.toBe(channelOwnerKey("u1"));
  });
});

describe("сводка для списка", () => {
  it("наружу уходят размер и время, но не сам холст", () => {
    /* История открывается часто, а снимок — это весь холст целиком: отдавать
       его списком значит гонять мегабайты ради показа дат. */
    const out = summarize([{ id: "s1", createdAt: new Date(NOW), data: "12345" }]);
    expect(out).toEqual([{ id: "s1", createdAt: new Date(NOW), size: 5 }]);
    expect(JSON.stringify(out)).not.toContain("12345");
  });
});
