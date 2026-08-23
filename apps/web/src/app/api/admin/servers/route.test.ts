/**
 * Тесты: /api/admin/servers — реестр узлов («Серверы» в админке).
 *
 * Маршрут был без тестов, а через него выдаются токены агентов — то есть доступ к
 * инфраструктуре, а не к содержимому. Здесь проверяется ровно то, что этот раздел
 * действительно делает:
 *
 *   • кто имеет право (только администратор, редактор — нет);
 *   • токен показывается ОДИН раз, в базе только его хеш, наружу не уходит никогда;
 *   • главный сервер ровно один;
 *   • точка подключения приводится к host:port, потому что у WireGuard нет URL;
 *   • правка пула внешних адресов перезакрепляет затронутых пиров.
 *
 * Чего эти тесты НЕ утверждают: что назначение узла (медиа, вычисления) на
 * что-то влияет. Сегодня влияют два: VPN и хранилище — см. отдельный блок в
 * конце файла, он это фиксирует намеренно.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/sanitize", () => ({ sanitizeText: (text: string) => text }));

const rebalanceExitIps = vi.fn().mockResolvedValue(0);
vi.mock("@/lib/vpn", async () => {
  const actual = await vi.importActual<typeof import("@/lib/vpn")>("@/lib/vpn");
  return { ...actual, rebalanceExitIps: (...a: unknown[]) => rebalanceExitIps(...a) };
});

import { getServerSession } from "next-auth";
import { hashAgentToken } from "@/lib/serverMesh";

const mockSession = vi.mocked(getServerSession);

function node(over: Record<string, unknown> = {}) {
  return row({
    id: "n1",
    name: "vpn-1",
    role: "CHILD",
    kind: "VPN",
    url: "",
    endpointHost: "",
    transport: "OBFUSCATED",
    obfuscation: "",
    region: "",
    publicIps: "",
    storageEndpoint: "",
    storageBucket: "",
    storageRegion: "us-east-1",
    storageKeyId: "",
    storageSecretEnc: "",
    tokenHash: null,
    lastReport: null,
    lastSeenAt: null,
    enabled: true,
    note: "",
    createdAt: new Date(),
    ...over,
  });
}

function request(method: string, body?: unknown, url = "http://localhost/api/admin/servers") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, url?: string) {
  const mod = await import("@/app/api/admin/servers/route");
  const res =
    method === "GET"
      ? await mod.GET()
      : method === "POST"
      ? await mod.POST(request("POST", body))
      : method === "PATCH"
      ? await mod.PATCH(request("PATCH", body))
      : await mod.DELETE(request("DELETE", undefined, url));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  /* Ключ шифрования настроек: без него не зашифровать секрет хранилища. На бою
     он есть всегда — приложение без него не поднимается. */
  process.env.ENCRYPTION_SECRET = "тестовый-ключ-шифрования-настроек";
  rebalanceExitIps.mockClear().mockResolvedValue(0);
  mockSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
  prismaMock.serverNode.findMany.mockResolvedValue(row([]));
  prismaMock.serverNode.findFirst.mockResolvedValue(row(null));
  prismaMock.serverNode.findUnique.mockResolvedValue(row(null));
  prismaMock.serverNode.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(node(data)) as never,
  );
  prismaMock.serverNode.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(node(data)) as never,
  );
  prismaMock.serverNode.delete.mockResolvedValue(node());
  // STORAGE-PRIORITY: по умолчанию на узле файлов нет — удаление разрешено.
  prismaMock.uploadedFile.count.mockResolvedValue(row(0));
});

describe("кто управляет узлами", () => {
  /**
   * ИНВАРИАНТ: реестр узлов — только для администратора. Редактор правит
   * содержимое сайта; узлы и их токены — это доступ к инфраструктуре, и он к ней
   * отношения не имеет.
   */
  it("ИНВАРИАНТ: редактор не допускается ни к одному действию", async () => {
    mockSession.mockResolvedValue({ user: { id: "e1", role: "EDITOR" } } as never);
    expect((await call("GET")).status).toBe(403);
    expect((await call("POST", { name: "x" })).status).toBe(403);
    expect((await call("PATCH", { id: "n1" })).status).toBe(403);
    expect((await call("DELETE", undefined, "http://localhost/api/admin/servers?id=n1")).status).toBe(403);
    expect(prismaMock.serverNode.create).not.toHaveBeenCalled();
    expect(prismaMock.serverNode.update).not.toHaveBeenCalled();
    expect(prismaMock.serverNode.delete).not.toHaveBeenCalled();
  });

  it("без сессии — тоже 403", async () => {
    mockSession.mockResolvedValue(null);
    expect((await call("GET")).status).toBe(403);
  });
});

describe("токен агента", () => {
  /**
   * ИНВАРИАНТ И ГЛАВНОЕ В ЭТОМ РАЗДЕЛЕ: в базе лежит только ХЕШ токена. Сам токен
   * возвращается ровно один раз — в ответе на создание узла. Иначе утечка базы
   * означала бы готовые ключи ко всем узлам.
   */
  it("ИНВАРИАНТ: сохраняется хеш, а не сам токен", async () => {
    const { body } = await call("POST", { name: "vpn-2", kind: "VPN" });
    const token = body.token as string;
    /* Токен — случайные байты в безопасном для адресов base64: длинный и без
       разделителей, чтобы его можно было положить в переменную окружения узла. */
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    const args = prismaMock.serverNode.create.mock.calls[0][0] as { data: { tokenHash: string } };
    expect(args.data.tokenHash).toBe(hashAgentToken(token));
    expect(args.data.tokenHash).not.toBe(token);
  });

  /**
   * ИНВАРИАНТ: при чтении списка токена нет — ни самого, ни хеша. Только признак
   * «выпущен». Список открывается часто, и утечь он может куда проще.
   */
  it("ИНВАРИАНТ: список узлов не отдаёт ни токен, ни его хеш", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([node({ tokenHash: "деадбиф" })]));
    const { body } = await call("GET");
    const text = JSON.stringify(body);
    expect(body.nodes[0].hasToken).toBe(true);
    expect(text).not.toContain("деадбиф");
    expect(text).not.toContain("tokenHash");
  });

  it("главному серверу токен не выпускается: это мы сами", async () => {
    const { body } = await call("POST", { name: "main", role: "MAIN" });
    expect(body.token).toBeNull();
    const args = prismaMock.serverNode.create.mock.calls[0][0] as { data: { tokenHash: string | null } };
    expect(args.data.tokenHash).toBeNull();
  });

  /**
   * ИНВАРИАНТ: перевыпуск даёт НОВЫЙ токен и новый хеш — прежний агент перестаёт
   * приниматься немедленно. На этом держится отзыв доступа у потерянного узла.
   */
  it("ИНВАРИАНТ: перевыпуск заменяет хеш и возвращает новый токен", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node({ tokenHash: hashAgentToken("старый") }));
    const { body } = await call("PATCH", { id: "n1", rotateToken: true });
    const args = prismaMock.serverNode.update.mock.calls[0][0] as { data: { tokenHash: string } };
    expect(body.token).toBeTruthy();
    expect(args.data.tokenHash).toBe(hashAgentToken(body.token));
    expect(args.data.tokenHash).not.toBe(hashAgentToken("старый"));
  });

  it("главному серверу перевыпускать нечего — 400", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node({ role: "MAIN" }));
    expect((await call("PATCH", { id: "n1", rotateToken: true })).status).toBe(400);
  });
});

describe("создание узла", () => {
  it("без названия — 400", async () => {
    expect((await call("POST", { kind: "VPN" })).status).toBe(400);
    expect(prismaMock.serverNode.create).not.toHaveBeenCalled();
  });

  it("повтор названия — 409", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node());
    expect((await call("POST", { name: "vpn-1" })).status).toBe(409);
  });

  /**
   * ИНВАРИАНТ: главный сервер ровно один. Иначе дочерние узлы не поймут, кому
   * подчиняться, и отчёт уйдёт не туда.
   */
  it("ИНВАРИАНТ: второй главный сервер не создаётся", async () => {
    prismaMock.serverNode.findFirst.mockResolvedValue(node({ role: "MAIN" }));
    const { status, body } = await call("POST", { name: "main-2", role: "MAIN" });
    expect(status).toBe(409);
    expect(body.error).toMatch(/[Гг]лавный сервер/);
  });

  it("незнакомые роль и назначение приводятся к безопасным значениям", async () => {
    await call("POST", { name: "x", role: "БОСС", kind: "КВАНТОВЫЙ" });
    const args = prismaMock.serverNode.create.mock.calls[0][0] as { data: { role: string; kind: string } };
    expect(args.data.role).toBe("CHILD");
    expect(args.data.kind).toBe("APP");
  });

  /**
   * ИНВАРИАНТ: у WireGuard нет URL — клиенту нужен host:port по UDP. Вставленная
   * ссылка приводится к рабочему значению, а не отбрасывается молча.
   */
  it("ИНВАРИАНТ: точка подключения приводится к host:port", async () => {
    await call("POST", { name: "vpn-3", kind: "VPN", endpointHost: "https://vpn1.example.ru/panel" });
    const args = prismaMock.serverNode.create.mock.calls[0][0] as { data: { endpointHost: string } };
    expect(args.data.endpointHost).toBe("vpn1.example.ru:51820");
  });

  it("адрес узла принимается только по http(s)", async () => {
    await call("POST", { name: "m1", kind: "MEDIA", url: "javascript:alert(1)" });
    const args = prismaMock.serverNode.create.mock.calls[0][0] as { data: { url: string } };
    expect(args.data.url).toBe("");
  });
});

describe("правка узла", () => {
  beforeEach(() => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node());
  });

  it("несуществующий узел — 404", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(row(null));
    expect((await call("PATCH", { id: "нет" })).status).toBe(404);
  });

  it("без идентификатора — 400", async () => {
    expect((await call("PATCH", {})).status).toBe(400);
  });

  it("пул внешних адресов очищается от мусора", async () => {
    await call("PATCH", { id: "n1", publicIps: "1.2.3.4, 999.1.1.1, домен.ру, 1.2.3.5" });
    const args = prismaMock.serverNode.update.mock.calls[0][0] as { data: { publicIps: string } };
    expect(args.data.publicIps).toBe("1.2.3.4, 1.2.3.5");
  });

  /**
   * ИНВАРИАНТ: смена пула перезакрепляет затронутых пиров. Убранный из пула адрес
   * иначе остался бы за пиром, и узел делал бы подмену на адрес, которого на
   * машине больше нет: туннель поднят, а интернета нет.
   */
  it("ИНВАРИАНТ: после смены пула вызывается перезакрепление", async () => {
    await call("PATCH", { id: "n1", publicIps: "1.2.3.4" });
    expect(rebalanceExitIps).toHaveBeenCalledWith("n1", "1.2.3.4");
  });

  it("правка без пула перезакрепление не запускает", async () => {
    await call("PATCH", { id: "n1", note: "переехал в другую стойку" });
    expect(rebalanceExitIps).not.toHaveBeenCalled();
  });

  it("сбой перезакрепления не роняет саму правку", async () => {
    rebalanceExitIps.mockRejectedValue(new Error("база недоступна"));
    expect((await call("PATCH", { id: "n1", publicIps: "1.2.3.4" })).status).toBe(200);
  });

  it("выключение узла сохраняется как есть", async () => {
    await call("PATCH", { id: "n1", enabled: false });
    const args = prismaMock.serverNode.update.mock.calls[0][0] as { data: { enabled: boolean } };
    expect(args.data.enabled).toBe(false);
  });
});

describe("удаление узла", () => {
  it("без идентификатора — 400", async () => {
    expect((await call("DELETE")).status).toBe(400);
  });

  it("несуществующий — 404", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(row(null));
    expect((await call("DELETE", undefined, "http://localhost/api/admin/servers?id=нет")).status).toBe(404);
  });

  it("существующий удаляется", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node());
    expect((await call("DELETE", undefined, "http://localhost/api/admin/servers?id=n1")).status).toBe(200);
    expect(prismaMock.serverNode.delete).toHaveBeenCalledWith({ where: { id: "n1" } });
  });
});

/**
 * ── Что связка узлов делает НА САМОМ ДЕЛЕ ────────────────────────────────────
 *
 * Раньше здесь стояла фиксация обратного: назначения «Медиа», «Хранилище» и
 * «Вычисления» были ПОДПИСЯМИ, и ни один путь загрузки на реестр узлов не
 * смотрел. Про «Хранилище» это больше не так — появился приоритет дочернего
 * узла (STORAGE-PRIORITY), и тот тест упал, как и было обещано в его описании.
 *
 * Что осталось правдой и закрепляется тут:
 *
 *   • раскладка каталогов на диске от реестра по-прежнему не зависит: файл
 *     сначала ложится локально и только потом уезжает — так загрузка не зависит
 *     от чужой машины;
 *   • «Медиа» и «Вычисления» так и остались подписями.
 */
describe("граница: на что назначение узла влияет сегодня", () => {
  it("ФИКСАЦИЯ: каталоги на диске не зависят от реестра узлов", async () => {
    const { uploadDirRoot } = await import("@/lib/uploadPaths");
    const before = uploadDirRoot("documents");

    prismaMock.serverNode.findMany.mockResolvedValue(
      row([node({ id: "s1", kind: "STORAGE", name: "storage-1", url: "https://storage.example.ru" })]),
    );
    await call("GET");

    /* Место первой записи прежнее: узел получает файл после неё, а не вместо. */
    expect(uploadDirRoot("documents")).toBe(before);
    expect(before).toContain("storage/uploads/documents");
    expect(before).not.toContain("storage.example.ru");
  });
});

/**
 * ── STORAGE-PRIORITY: настройки узла хранения ────────────────────────────────
 *
 * Узел принимает файлы только полностью настроенным. Полдела здесь хуже, чем
 * ничего: недонастроенный узел молча выпадает из выбора, и администратор не
 * понимает, почему файлы остались на главном сервере. Поэтому маршрут отказывает
 * словами, а не тишиной.
 */
describe("STORAGE-PRIORITY: хранилище узла", () => {
  it("настройки сохраняются, секрет уходит в базу зашифрованным", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node({ kind: "STORAGE" }));
    await call("PATCH", {
      id: "n1",
      storageEndpoint: "https://files1.example.ru:9000",
      storageBucket: "TrioZ",
      storageKeyId: "KEY",
      storageSecret: "очень-секретный-ключ",
    });
    const data = prismaMock.serverNode.update.mock.calls[0]![0].data as Record<string, string>;
    expect(data.storageEndpoint).toBe("https://files1.example.ru:9000");
    // Имя корзины приводится к нижнему регистру: протокол регистр различает.
    expect(data.storageBucket).toBe("trioz");
    expect(data.storageSecretEnc).not.toContain("очень-секретный-ключ");
    expect(data.storageSecretEnc.length).toBeGreaterThan(10);
  });

  it("ФИКСАЦИЯ: секретный ключ не отдаётся наружу никогда — только признак", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(
      row([node({ kind: "STORAGE", storageSecretEnc: "зашифрованное-значение", storageKeyId: "KEY" })]),
    );
    const res = await call("GET");
    const first = res.body.nodes[0] as Record<string, unknown>;
    expect(first.hasStorageSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("зашифрованное-значение");
    expect(first.storageSecretEnc).toBeUndefined();
  });

  it("пустой секрет означает «поле не трогали», а не «стереть ключ»", async () => {
    /* Форма ключ не показывает: если бы пустая строка стирала его, любое
       сохранение соседнего поля отключало бы узел. */
    prismaMock.serverNode.findUnique.mockResolvedValue(node({ kind: "STORAGE" }));
    await call("PATCH", { id: "n1", storageSecret: "", note: "правка подписи" });
    const data = prismaMock.serverNode.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("storageSecretEnc");
  });

  it("убрать ключ можно только явно", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node({ kind: "STORAGE" }));
    await call("PATCH", { id: "n1", clearStorageSecret: true });
    const data = prismaMock.serverNode.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.storageSecretEnc).toBe("");
  });

  it("негодный адрес хранилища отклоняется словами", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node({ kind: "STORAGE" }));
    const res = await call("PATCH", { id: "n1", storageEndpoint: "файлы-у-меня" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/адрес/i);
    expect(prismaMock.serverNode.update).not.toHaveBeenCalled();
  });

  it("негодное имя корзины отклоняется", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node({ kind: "STORAGE" }));
    const res = await call("PATCH", { id: "n1", storageBucket: "моя корзина" });
    expect(res.status).toBe(400);
  });

  it("пустой регион не остаётся пустым: подпись без него не считается", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node({ kind: "STORAGE" }));
    await call("PATCH", { id: "n1", storageRegion: "  " });
    const data = prismaMock.serverNode.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.storageRegion).toBe("us-east-1");
  });

  /**
   * ИНВАРИАНТ И ГЛАВНОЕ В ЭТОМ БЛОКЕ: узел с файлами удалить нельзя.
   *
   * Запись узла — единственное, что связывает адрес вложения с машиной, где
   * файл лежит. Удалить её означает оставить указатели в пустоту: вложения в
   * переписке перестанут открываться, и восстановить связь будет нечем.
   */
  it("ИНВАРИАНТ: узел с файлами не удаляется, пока файлы не вернули", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node({ kind: "STORAGE" }));
    prismaMock.uploadedFile.count.mockResolvedValue(row(1240));
    const res = await call("DELETE", undefined, "http://localhost/api/admin/servers?id=n1");
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toContain("1240");
    expect(prismaMock.serverNode.delete).not.toHaveBeenCalled();
  });

  it("узел без файлов удаляется как раньше", async () => {
    prismaMock.serverNode.findUnique.mockResolvedValue(node({ kind: "STORAGE" }));
    prismaMock.uploadedFile.count.mockResolvedValue(row(0));
    const res = await call("DELETE", undefined, "http://localhost/api/admin/servers?id=n1");
    expect(res.status).toBe(200);
    expect(prismaMock.serverNode.delete).toHaveBeenCalled();
  });
});
