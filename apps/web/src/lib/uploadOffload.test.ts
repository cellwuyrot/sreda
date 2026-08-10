/**
 * Тесты: src/lib/uploadOffload.ts — переезд файла на узел хранения.
 *
 * Здесь проверяется не «работает ли S3», а порядок действий и поведение при
 * сбое. Именно на них теряются файлы:
 *
 *   • указатель в базе меняется ТОЛЬКО после подтверждённой копии на узле;
 *   • локальный файл удаляется ТОЛЬКО после указателя;
 *   • узел не отвечает — файл остаётся на главном сервере, и загрузка не падает.
 *
 * Порядок закреплён явно (последовательностью вызовов), потому что переставить
 * две строки местами легко, а последствия видны не сразу: указатель, ведущий на
 * ещё не скопированный файл, отдаёт человеку пустоту.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const calls: string[] = [];

/** Содержимое «файла на диске». Размер важен: по нему идёт проверка после копии. */
const FILE = Buffer.from("содержимое файла");

const fsMock = {
  readFile: vi.fn(async () => FILE),
  unlink: vi.fn(async () => {
    calls.push("unlink");
  }),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
};
vi.mock("fs/promises", () => fsMock);

let fileExists = true;
vi.mock("fs", () => ({ existsSync: () => fileExists }));

const store = {
  putObject: vi.fn(async () => {
    calls.push("put");
  }),
  headObject: vi.fn(async () => FILE.length),
  getObject: vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })),
  deleteObject: vi.fn(async () => undefined),
};
vi.mock("@/lib/objectStore", () => store);

vi.mock("@/lib/encryption", () => ({ decrypt: (value: string) => (value ? "секрет" : "") }));

const {
  currentTargetNode,
  migrateBatch,
  offloadUpload,
  remoteLocationFor,
  resetPlacementCache,
  restoreToMain,
} = await import("@/lib/uploadOffload");

function storageNode(over: Record<string, unknown> = {}) {
  return {
    id: "n1",
    name: "Хранилище-1",
    role: "CHILD",
    kind: "STORAGE",
    enabled: true,
    storageEndpoint: "https://files1.example.ru:9000",
    storageBucket: "trioz",
    storageRegion: "ru-1",
    storageKeyId: "KEY",
    storageSecretEnc: "зашифровано",
    ...over,
  };
}

beforeEach(() => {
  calls.length = 0;
  fileExists = true;
  resetPlacementCache();
  fsMock.readFile.mockClear();
  fsMock.unlink.mockClear();
  store.putObject.mockClear();
  store.headObject.mockClear();
  store.putObject.mockImplementation(async () => {
    calls.push("put");
  });
  store.headObject.mockImplementation(async () => FILE.length);
  prismaMock.uploadedFile.updateMany.mockImplementation((async () => {
    calls.push("pointer");
    return { count: 1 };
  }) as never);
});

describe("STORAGE-PRIORITY: выбор узла на живой базе", () => {
  it("узлов нет — работаем как раньше, на главном сервере", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([]));
    expect(await currentTargetNode()).toBeNull();
    expect(await offloadUpload("messages/a.webp")).toBe(false);
    expect(store.putObject).not.toHaveBeenCalled();
  });

  it("узел есть — он и становится местом для новых файлов", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([storageNode()]));
    expect((await currentTargetNode())?.id).toBe("n1");
  });

  it("ФИКСАЦИЯ: испорченный секрет не роняет загрузку, а отключает узел", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([storageNode({ storageSecretEnc: "" })]));
    expect(await offloadUpload("messages/a.webp")).toBe(false);
  });

  it("падение базы при выборе узла — тоже просто «главный сервер»", async () => {
    prismaMock.serverNode.findMany.mockRejectedValue(new Error("база недоступна"));
    expect(await currentTargetNode()).toBeNull();
  });
});

describe("STORAGE-PRIORITY: перенос одного файла", () => {
  beforeEach(() => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([storageNode()]));
  });

  it("ФИКСАЦИЯ: сначала копия, потом указатель, и только потом удаление", async () => {
    expect(await offloadUpload("messages/a.webp")).toBe(true);
    expect(calls).toEqual(["put", "pointer", "unlink"]);
  });

  it("указатель ведёт на узел и хранит размер", async () => {
    await offloadUpload("messages/a.webp");
    expect(prismaMock.uploadedFile.updateMany).toHaveBeenCalledWith({
      where: { path: "messages/a.webp" },
      data: { nodeId: "n1", size: FILE.length },
    });
  });

  it("ФИКСАЦИЯ: узел не принял файл — локальный на месте, указатель не тронут", async () => {
    store.putObject.mockRejectedValueOnce(new Error("узел недоступен"));
    expect(await offloadUpload("messages/a.webp")).toBe(false);
    expect(prismaMock.uploadedFile.updateMany).not.toHaveBeenCalled();
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it("ФИКСАЦИЯ: размер на узле не сошёлся — файл считается непринятым", async () => {
    /* Подтверждение приёма и сохранность — разные вещи: обрыв на середине даёт
       успешный ответ и битый файл. Удалить локальный в этом случае нельзя. */
    store.headObject.mockResolvedValueOnce(3);
    expect(await offloadUpload("messages/a.webp")).toBe(false);
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it("после сбоя узел уходит в отдых: следующая загрузка идёт на главный сразу", async () => {
    store.putObject.mockRejectedValueOnce(new Error("узел недоступен"));
    await offloadUpload("messages/a.webp");
    store.putObject.mockClear();
    expect(await offloadUpload("messages/b.webp")).toBe(false);
    expect(store.putObject).not.toHaveBeenCalled();
  });

  it("файла нет на диске — переносить нечего", async () => {
    fileExists = false;
    expect(await offloadUpload("messages/нет.webp")).toBe(false);
    expect(store.putObject).not.toHaveBeenCalled();
  });
});

describe("STORAGE-PRIORITY: где искать файл при выдаче", () => {
  it("файл на главном сервере — узел не спрашиваем", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({ nodeId: null }));
    expect(await remoteLocationFor("messages/a.webp")).toBeNull();
  });

  it("файл на узле — отдаём адрес и ключ", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({ nodeId: "n1" }));
    prismaMock.serverNode.findUnique.mockResolvedValue(row(storageNode()));
    const remote = await remoteLocationFor("messages/a.webp");
    expect(remote?.key).toBe("messages/a.webp");
    expect(remote?.target.bucket).toBe("trioz");
    expect(remote?.nodeName).toBe("Хранилище-1");
  });

  it("узел удалён из реестра — молча ничего, а не падение раздатчика", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({ nodeId: "n1" }));
    prismaMock.serverNode.findUnique.mockResolvedValue(row(null));
    expect(await remoteLocationFor("messages/a.webp")).toBeNull();
  });
});

describe("STORAGE-PRIORITY: перенос накопленного", () => {
  it("без узла ничего не делает и говорит об этом", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([]));
    expect(await migrateBatch(10)).toEqual({ moved: 0, failed: 0, remaining: 0, nodeName: null });
  });

  it("переносит порцию и сообщает остаток", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([storageNode()]));
    prismaMock.uploadedFile.findMany.mockResolvedValue(
      row([{ path: "messages/a.webp" }, { path: "documents/b.pdf" }]),
    );
    prismaMock.uploadedFile.count.mockResolvedValue(row(7));
    const result = await migrateBatch(2);
    expect(result).toMatchObject({ moved: 2, failed: 0, remaining: 7, nodeName: "Хранилище-1" });
  });

  it("ФИКСАЦИЯ: порция обрывается, как только узел перестал отвечать", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([storageNode()]));
    prismaMock.uploadedFile.findMany.mockResolvedValue(
      row([{ path: "a/1" }, { path: "a/2" }, { path: "a/3" }]),
    );
    prismaMock.uploadedFile.count.mockResolvedValue(row(3));
    store.putObject.mockRejectedValue(new Error("узел лёг"));
    const result = await migrateBatch(3);
    /* Один провал — и дальше не пытаемся: остальные всё равно упадут, а время
       запроса администратора уйдёт на ожидание ответов от мёртвой машины. */
    expect(result.failed).toBe(1);
    expect(store.putObject).toHaveBeenCalledTimes(1);
  });
});

describe("STORAGE-PRIORITY: возврат на главный сервер", () => {
  it("файл возвращается, указатель обнуляется, копия на узле убирается", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({ nodeId: "n1" }));
    prismaMock.serverNode.findUnique.mockResolvedValue(row(storageNode()));
    expect(await restoreToMain("messages/a.webp")).toBe(true);
    expect(fsMock.writeFile).toHaveBeenCalled();
    expect(prismaMock.uploadedFile.updateMany).toHaveBeenCalledWith({
      where: { path: "messages/a.webp" },
      data: { nodeId: null },
    });
    expect(store.deleteObject).toHaveBeenCalled();
  });

  it("файла на узле нет — возвращать нечего", async () => {
    prismaMock.uploadedFile.findUnique.mockResolvedValue(row({ nodeId: null }));
    expect(await restoreToMain("messages/a.webp")).toBe(false);
  });
});
