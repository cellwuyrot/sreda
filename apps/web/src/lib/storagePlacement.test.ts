import { describe, it, expect } from "vitest";
import {
  isStorageConfigured,
  isUsableEndpoint,
  needsMigration,
  pickStorageNode,
  storageCandidates,
  storageObjectKey,
  type PlacementNode,
} from "@/lib/storagePlacement";

/**
 * STORAGE-PRIORITY: правило «есть дочерний узел — файлы туда, нет — на главный».
 *
 * Проверяется именно правило, без сети и базы: место файла — это решение, и
 * ошибка в нём означает потерянные вложения, а не медленную страницу.
 */

function node(over: Partial<PlacementNode> = {}): PlacementNode {
  return {
    id: "n1",
    name: "Хранилище-1",
    role: "CHILD",
    kind: "STORAGE",
    enabled: true,
    storageEndpoint: "https://files1.example.ru:9000",
    storageBucket: "trioz",
    storageKeyId: "KEY",
    hasSecret: true,
    ...over,
  };
}

describe("STORAGE-PRIORITY: выбор места", () => {
  it("нет узлов — файл остаётся на главном сервере", () => {
    expect(pickStorageNode([])).toBeNull();
  });

  it("появился настроенный узел — файл идёт на него", () => {
    const picked = pickStorageNode([node()]);
    expect(picked?.id).toBe("n1");
  });

  it("узел выключен — снова главный сервер", () => {
    expect(pickStorageNode([node({ enabled: false })])).toBeNull();
  });

  it("узел не того назначения в выборе не участвует", () => {
    expect(pickStorageNode([node({ kind: "VPN" })])).toBeNull();
    expect(pickStorageNode([node({ kind: "MEDIA" })])).toBeNull();
  });

  it("главный сервер не может быть узлом хранения для самого себя", () => {
    /* Иначе правка теряет смысл: файлы должны уходить С главного, а не
       ложиться на него другой дорогой. */
    expect(pickStorageNode([node({ role: "MAIN" })])).toBeNull();
  });

  it("ФИКСАЦИЯ: недонастроенный узел не выбирается — иначе файлы уйдут в никуда", () => {
    expect(pickStorageNode([node({ storageEndpoint: "" })])).toBeNull();
    expect(pickStorageNode([node({ storageBucket: " " })])).toBeNull();
    expect(pickStorageNode([node({ storageKeyId: "" })])).toBeNull();
    expect(pickStorageNode([node({ hasSecret: false })])).toBeNull();
  });

  it("адрес не http(s) считается ненастроенным", () => {
    expect(isUsableEndpoint("ftp://files.example.ru")).toBe(false);
    expect(isUsableEndpoint("файлы")).toBe(false);
    expect(isUsableEndpoint("")).toBe(false);
    expect(isUsableEndpoint("http://10.0.0.5:9000")).toBe(true);
  });

  it("isStorageConfigured отвечает за все четыре условия сразу", () => {
    expect(isStorageConfigured(node())).toBe(true);
    expect(isStorageConfigured(node({ storageBucket: "" }))).toBe(false);
  });

  it("ФИКСАЦИЯ: упавший узел на время выпадает, и загрузка идёт на главный", () => {
    const cooldown = new Map([["n1", 5_000]]);
    expect(pickStorageNode([node()], { cooldown, now: 1_000 })).toBeNull();
    // Время отдыха вышло — узел снова в игре.
    expect(pickStorageNode([node()], { cooldown, now: 6_000 })?.id).toBe("n1");
  });

  it("из двух узлов выбирается менее загруженный", () => {
    const nodes = [node({ id: "a", name: "А" }), node({ id: "b", name: "Б" })];
    const load = new Map([
      ["a", 100],
      ["b", 3],
    ]);
    expect(pickStorageNode(nodes, { load })?.id).toBe("b");
  });

  it("при равной нагрузке порядок устойчив: один и тот же ответ каждый раз", () => {
    const nodes = [node({ id: "b", name: "Бета" }), node({ id: "a", name: "Альфа" })];
    expect(pickStorageNode(nodes)?.id).toBe("a");
    expect(pickStorageNode([...nodes].reverse())?.id).toBe("a");
  });

  it("список кандидатов отдаёт все годные узлы, а не только первый", () => {
    const nodes = [node({ id: "a", name: "А" }), node({ id: "b", name: "Б" }), node({ id: "c", kind: "APP" })];
    expect(storageCandidates(nodes).map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("STORAGE-PRIORITY: имя объекта и перенос", () => {
  it("имя в корзине совпадает с путём на диске", () => {
    expect(storageObjectKey("messages/abc.webp")).toBe("messages/abc.webp");
    expect(storageObjectKey("/documents/файл.pdf")).toBe("documents/файл.pdf");
  });

  it("переносится только то, что лежит на главном сервере", () => {
    const target = node();
    expect(needsMigration({ nodeId: null }, target)).toBe(true);
    // Уже на узле — трогать нечего.
    expect(needsMigration({ nodeId: "n1" }, target)).toBe(false);
    // На ДРУГОМ узле: обратно и туда-сюда не гоняем, это отдельное решение.
    expect(needsMigration({ nodeId: "n2" }, target)).toBe(false);
    // Узла нет — переносить некуда.
    expect(needsMigration({ nodeId: null }, null)).toBe(false);
  });
});
