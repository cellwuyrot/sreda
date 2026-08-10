/**
 * Тесты: /api/admin/builds и /api/builds/* — сборка приложений на сервере.
 *
 * Раньше APK и установщик собирались руками на своём ПК. Теперь это делает
 * сервер, и здесь проверяется то, что в этой цепочке может стоить дорого:
 *
 *   • право ставить сборку — только у администратора;
 *   • токен VPN-узла не открывает сборку;
 *   • задачу не могут взять два агента разом;
 *   • чужой агент не может докладывать о чужой задаче;
 *   • отменённая задача останавливает агента — обратного канала к нему нет.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
import { hashAgentToken } from "@/lib/serverMesh";

const mockSession = vi.mocked(getServerSession);
/* Токен уходит в заголовок HTTP, поэтому только латиница: кириллица в заголовок
   физически не помещается — сам Request откажется его собрать. */
const TOKEN = "build-agent-token-example";

function job(over: Record<string, unknown> = {}) {
  return row({
    id: "b1",
    target: "ANDROID",
    status: "QUEUED",
    ref: "main",
    version: "",
    requestedById: "a1",
    nodeId: null,
    log: "",
    artifacts: "",
    error: "",
    createdAt: new Date("2026-08-02T10:00:00Z"),
    startedAt: null,
    heartbeatAt: null,
    finishedAt: null,
    ...over,
  });
}

function buildNode(over: Record<string, unknown> = {}) {
  return row({
    id: "n-build",
    name: "builder",
    role: "CHILD",
    kind: "BUILD",
    url: "",
    region: "",
    tokenHash: hashAgentToken(TOKEN),
    ...over,
  });
}

async function admin(method: "GET" | "POST" | "PATCH", body?: unknown, url = "http://localhost/api/admin/builds") {
  const mod = await import("@/app/api/admin/builds/route");
  const req = new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = method === "GET" ? await mod.GET(req) : method === "POST" ? await mod.POST(req) : await mod.PATCH(req);
  return { status: res.status, body: await res.json() };
}

async function agentNext(token = TOKEN) {
  const mod = await import("@/app/api/builds/next/route");
  const res = await mod.POST(
    new Request("http://localhost/api/builds/next", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function agentReport(id: string, body: unknown, token = TOKEN) {
  const mod = await import("@/app/api/builds/[id]/route");
  const res = await mod.POST(
    new Request(`http://localhost/api/builds/${id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
  prismaMock.buildJob.findMany.mockResolvedValue(row([]));
  prismaMock.buildJob.findUnique.mockResolvedValue(row(null));
  prismaMock.buildJob.create.mockImplementation((({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(job(data))) as never);
  prismaMock.buildJob.update.mockImplementation((({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(job(data))) as never);
  prismaMock.buildJob.updateMany.mockResolvedValue(row({ count: 1 }));
  prismaMock.serverNode.findMany.mockResolvedValue(row([buildNode()]));
  prismaMock.serverNode.findFirst.mockResolvedValue(row(null));
  prismaMock.serverNode.update.mockResolvedValue(buildNode());
});

describe("кто ставит сборки", () => {
  it("ИНВАРИАНТ: редактор не допускается — сборка раздаётся всем", async () => {
    mockSession.mockResolvedValue({ user: { id: "e1", role: "EDITOR" } } as never);
    expect((await admin("GET")).status).toBe(403);
    expect((await admin("POST", { target: "ANDROID" })).status).toBe(403);
    expect((await admin("PATCH", { id: "b1", action: "cancel" })).status).toBe(403);
    expect(prismaMock.buildJob.create).not.toHaveBeenCalled();
  });

  it("без сессии — 403", async () => {
    mockSession.mockResolvedValue(null);
    expect((await admin("GET")).status).toBe(403);
  });
});

describe("постановка в очередь", () => {
  it("ставится задача с веткой по умолчанию", async () => {
    const res = await admin("POST", { target: "ANDROID" });
    expect(res.status).toBe(200);
    const data = prismaMock.buildJob.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ target: "ANDROID", ref: "main", status: "QUEUED", requestedById: "a1" });
  });

  it("неизвестная цель отклоняется", async () => {
    expect((await admin("POST", { target: "IOS" })).status).toBe(400);
    expect(prismaMock.buildJob.create).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: в имя ветки нельзя вписать команду", async () => {
    const res = await admin("POST", { target: "ANDROID", ref: "main; rm -rf /" });
    expect(res.status).toBe(400);
    expect(prismaMock.buildJob.create).not.toHaveBeenCalled();
  });

  it("ФИКСАЦИЯ: повторное нажатие не создаёт вторую такую же сборку", async () => {
    prismaMock.buildJob.findMany.mockResolvedValue(row([job()]));
    const res = await admin("POST", { target: "ANDROID" });
    expect(res.status).toBe(409);
    expect(prismaMock.buildJob.create).not.toHaveBeenCalled();
  });

  it("вторая цель ставится, пока идёт первая", async () => {
    prismaMock.buildJob.findMany.mockResolvedValue(row([job({ status: "RUNNING", startedAt: new Date() })]));
    expect((await admin("POST", { target: "WINDOWS" })).status).toBe(200);
  });
});

describe("список и журнал", () => {
  it("список не тащит журнал каждой сборки", async () => {
    prismaMock.buildJob.findMany.mockResolvedValue(row([job({ log: "очень длинный журнал" })]));
    const res = await admin("GET");
    expect(res.body.jobs[0].log).toBeUndefined();
  });

  it("журнал отдаётся по запросу одной сборки", async () => {
    prismaMock.buildJob.findUnique.mockResolvedValue(job({ log: "строка журнала" }));
    const res = await admin("GET", undefined, "http://localhost/api/admin/builds?id=b1");
    expect(res.body.job.log).toBe("строка журнала");
  });

  it("ФИКСАЦИЯ: брошенная сборка закрывается сама, а не держит очередь вечно", async () => {
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    prismaMock.buildJob.findMany.mockResolvedValue(row([job({ status: "RUNNING", startedAt: longAgo, heartbeatAt: longAgo })]));
    await admin("GET");
    const data = prismaMock.buildJob.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.status).toBe("FAILED");
    expect(String(data.error)).toMatch(/перестал отвечать/);
  });

  it("панель показывает, есть ли вообще агент сборки", async () => {
    prismaMock.serverNode.findFirst.mockResolvedValue(row({ name: "builder", lastSeenAt: new Date() }));
    expect((await admin("GET")).body.agent.name).toBe("builder");
    prismaMock.serverNode.findFirst.mockResolvedValue(row(null));
    expect((await admin("GET")).body.agent).toBeNull();
  });
});

describe("агент берёт работу", () => {
  it("без токена — 401", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([]));
    expect((await agentNext("someone-elses-token")).status).toBe(401);
  });

  it("ИНВАРИАНТ: токен VPN-узла сборку не открывает", async () => {
    prismaMock.serverNode.findMany.mockResolvedValue(row([buildNode({ kind: "VPN" })]));
    expect((await agentNext()).status).toBe(403);
  });

  it("очередь пуста — работы нет, и это нормальный ответ", async () => {
    prismaMock.buildJob.findMany.mockResolvedValue(row([]));
    const res = await agentNext();
    expect(res.status).toBe(200);
    expect(res.body.job).toBeNull();
  });

  it("задача берётся и переходит в работу", async () => {
    prismaMock.buildJob.findMany.mockResolvedValue(row([job()]));
    prismaMock.buildJob.findUnique.mockResolvedValue(job({ status: "RUNNING" }));
    const res = await agentNext();
    expect(res.body.job).toMatchObject({ id: "b1", target: "ANDROID", ref: "main" });
    const where = prismaMock.buildJob.updateMany.mock.calls[0]![0].where as Record<string, unknown>;
    /* Условие «status: QUEUED» — защита от двух агентов: второй получит ноль
       изменённых строк и уйдёт ни с чем. */
    expect(where).toMatchObject({ id: "b1", status: "QUEUED" });
  });

  it("ФИКСАЦИЯ: задачу, которую перехватил другой агент, второй не получает", async () => {
    prismaMock.buildJob.findMany.mockResolvedValue(row([job()]));
    prismaMock.buildJob.updateMany.mockResolvedValue(row({ count: 0 }));
    expect((await agentNext()).body.job).toBeNull();
  });

  it("отметка «на связи» ставится узлу при каждом обращении", async () => {
    await agentNext();
    expect(prismaMock.serverNode.update).toHaveBeenCalled();
  });
});

describe("агент докладывает", () => {
  beforeEach(() => {
    prismaMock.buildJob.findUnique.mockResolvedValue(job({ status: "RUNNING", nodeId: "n-build", log: "начало\n" }));
  });

  it("журнал дописывается кусками", async () => {
    await agentReport("b1", { log: "шаг 1\n" });
    const data = prismaMock.buildJob.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.log).toBe("начало\nшаг 1\n");
    expect(data.heartbeatAt).toBeInstanceOf(Date);
  });

  it("успех записывает версию и имена файлов", async () => {
    await agentReport("b1", { status: "SUCCESS", version: "0.3.3", artifacts: ["connect.apk"] });
    const data = prismaMock.buildJob.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ status: "SUCCESS", version: "0.3.3", artifacts: "connect.apk", error: "" });
  });

  it("ИНВАРИАНТ: имя файла от агента не может быть путём", async () => {
    await agentReport("b1", { status: "SUCCESS", artifacts: ["../../etc/passwd", "connect.apk"] });
    const data = prismaMock.buildJob.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.artifacts).toBe("connect.apk");
  });

  it("отказ без причины всё равно получает причину", async () => {
    await agentReport("b1", { status: "FAILED" });
    const data = prismaMock.buildJob.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(String(data.error)).toMatch(/ошибкой/);
  });

  it("агент не может объявить задачу отменённой или ждущей", async () => {
    for (const status of ["CANCELED", "QUEUED", "RUNNING"]) {
      const res = await agentReport("b1", { status });
      expect(res.status, status).toBe(400);
    }
  });

  it("ИНВАРИАНТ: чужую задачу трогать нельзя", async () => {
    prismaMock.buildJob.findUnique.mockResolvedValue(job({ status: "RUNNING", nodeId: "другой-узел" }));
    const res = await agentReport("b1", { log: "чужое" });
    expect(res.status).toBe(409);
    expect(prismaMock.buildJob.update).not.toHaveBeenCalled();
  });

  it("ФИКСАЦИЯ: отменённая задача останавливает агента ответом", async () => {
    /* Обратного канала к агенту нет — связь односторонняя. Единственный способ
       сказать «хватит» — ответ на его собственный доклад. */
    prismaMock.buildJob.findUnique.mockResolvedValue(job({ status: "CANCELED" }));
    const res = await agentReport("b1", { log: "продолжаю" });
    expect(res.body).toMatchObject({ ok: false, canceled: true });
    expect(prismaMock.buildJob.update).not.toHaveBeenCalled();
  });
});

describe("отмена администратором", () => {
  it("ждущая задача отменяется", async () => {
    prismaMock.buildJob.findUnique.mockResolvedValue(job({ status: "QUEUED" }));
    const res = await admin("PATCH", { id: "b1", action: "cancel" });
    expect(res.status).toBe(200);
    const data = prismaMock.buildJob.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.status).toBe("CANCELED");
  });

  it("законченную отменить нельзя", async () => {
    prismaMock.buildJob.findUnique.mockResolvedValue(job({ status: "SUCCESS" }));
    expect((await admin("PATCH", { id: "b1", action: "cancel" })).status).toBe(409);
  });

  it("неизвестное действие отклоняется", async () => {
    expect((await admin("PATCH", { id: "b1", action: "удалить" })).status).toBe(400);
  });
});
