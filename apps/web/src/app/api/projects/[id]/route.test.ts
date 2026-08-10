/**
 * Тесты: PATCH /api/projects/[id] — отметка выполненных этапов проекта.
 *
 * Проверяется то, ради чего маршрут переписан, и то, чем он может навредить:
 *
 *   • этапы берутся из УСЛУГИ проекта, а не из вшитого списка сайта;
 *   • отметить можно только этап своего набора — иначе кабинет показал бы
 *     прогресс по работе, которой в заказе нет;
 *   • откат невозможен: выполненный этап снять нельзя, процент только растёт;
 *   • сто процентов переводят проект в завершённое состояние.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const createNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/createNotification", () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
}));

import { getServerSession } from "next-auth";
const mockSession = vi.mocked(getServerSession);

const params = { params: Promise.resolve({ id: "p1" }) };

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/projects/p1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

async function patch(body?: unknown) {
  const mod = await import("@/app/api/projects/[id]/route");
  const res = await mod.PATCH(makeRequest(body), params);
  return { status: res.status, body: await res.json() };
}

/** Проект по «Честному Знаку»: восемь этапов, а не десять сайтовых. */
function honestProject(stepsDone: unknown[] = []) {
  return row({
    id: "p1",
    name: "Маркировка обуви",
    ownerId: "client",
    status: "NEW",
    stepsDone,
    service: { id: "svc1", title: "Честный Знак", icon: null, stages: null },
  });
}

beforeEach(() => {
  createNotification.mockClear().mockResolvedValue(undefined);
  mockSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
  prismaMock.partnerProject.findUnique.mockResolvedValue(honestProject());
  prismaMock.partnerProject.update.mockResolvedValue(row({ id: "p1" }));
});

describe("кто отмечает этапы", () => {
  it("без входа — 401", async () => {
    mockSession.mockResolvedValue(null);
    expect((await patch({ steps: ["honest-1"] })).status).toBe(401);
  });

  it("ИНВАРИАНТ: владелец проекта не отмечает этапы сам себе", async () => {
    /* Прогресс — слово исполнителя о сделанной работе. Позволь заказчику
       отмечать этапы, и «готово на 100%» перестанет что-либо значить. */
    mockSession.mockResolvedValue({ user: { id: "client", role: "CONSULTANT" } } as never);
    expect((await patch({ steps: ["honest-1"] })).status).toBe(403);
    expect(prismaMock.partnerProject.update).not.toHaveBeenCalled();
  });

  it("несуществующий проект — 404", async () => {
    prismaMock.partnerProject.findUnique.mockResolvedValue(null as never);
    expect((await patch({ steps: ["honest-1"] })).status).toBe(404);
  });
});

describe("набор этапов берётся из услуги", () => {
  it("ИНВАРИАНТ: этап чужого набора не принимается", async () => {
    /* «site-4» — это «Дизайн-макет подготовлен». У подключения к «Честному
       Знаку» такой работы нет, и показывать по ней прогресс нельзя. */
    const res = await patch({ steps: ["site-4"] });
    expect(res.status).toBe(400);
    expect(prismaMock.partnerProject.update).not.toHaveBeenCalled();
  });

  it("этап своего набора принимается и даёт процент от его длины", async () => {
    /* Восемь этапов: один выполненный — 13%, а не 10% как у сайта. */
    const res = await patch({ steps: ["honest-1"] });
    expect(res.status).toBe(200);
    /* Приведение через unknown: у Json-полей Prisma тип входа объединяет
       массивы с DbNull, и прямое сужение до string[] компилятор не пропускает. */
    const args = prismaMock.partnerProject.update.mock.calls[0]![0] as unknown as {
      data: { stepsDone: string[]; status: string };
    };
    expect(args.data.stepsDone).toEqual(["honest-1"]);
    expect(args.data.status).toBe("IN_PROGRESS");
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: "client",
      body: "«Маркировка обуви»: готово на 13%",
    }));
  });

  it("ФИКСАЦИЯ: свой набор услуги перебивает каталожный", async () => {
    prismaMock.partnerProject.findUnique.mockResolvedValue(row({
      id: "p1",
      name: "Маркировка обуви",
      ownerId: "client",
      status: "NEW",
      stepsDone: [],
      service: { id: "svc1", title: "Честный Знак", icon: null, stages: [{ id: "s1", title: "Свой этап" }] },
    }));
    expect((await patch({ steps: ["honest-1"] })).status).toBe(400);
    expect((await patch({ steps: ["s1"] })).status).toBe(200);
  });

  it("проект без услуги ведётся по набору сайта", async () => {
    /* Так вёлся каждый проект до появления связи с услугой. */
    prismaMock.partnerProject.findUnique.mockResolvedValue(row({
      id: "p1", name: "Сайт", ownerId: "client", status: "NEW", stepsDone: [], service: null,
    }));
    expect((await patch({ steps: ["site-4"] })).status).toBe(200);
  });
});

describe("необратимость и завершение", () => {
  it("ИНВАРИАНТ: уже выполненный этап снять нельзя", async () => {
    /* Откат означал бы, что процент готовности умеет падать, — заказчик увидел
       бы, что работа «расделалась». */
    prismaMock.partnerProject.findUnique.mockResolvedValue(honestProject(["honest-1", "honest-2"]));
    const res = await patch({ steps: ["honest-1"] });
    expect(res.status).toBe(400);
    expect(prismaMock.partnerProject.update).not.toHaveBeenCalled();
  });

  it("новый этап добавляется к уже выполненным, порядок — по набору", async () => {
    prismaMock.partnerProject.findUnique.mockResolvedValue(honestProject(["honest-3"]));
    await patch({ steps: ["honest-1"] });
    const args = prismaMock.partnerProject.update.mock.calls[0]![0] as unknown as { data: { stepsDone: string[] } };
    expect(args.data.stepsDone).toEqual(["honest-1", "honest-3"]);
  });

  it("ИНВАРИАНТ: последний этап набора закрывает проект", async () => {
    prismaMock.partnerProject.findUnique.mockResolvedValue(honestProject([
      "honest-1", "honest-2", "honest-3", "honest-4", "honest-5", "honest-6", "honest-7",
    ]));
    await patch({ steps: ["honest-8"] });
    const args = prismaMock.partnerProject.update.mock.calls[0]![0] as unknown as {
      data: { status: string };
    };
    expect(args.data.status).toBe("LAUNCHED");
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Работы по проекту завершены",
    }));
  });

  it("ФИКСАЦИЯ: старые номера пунктов уже накопленных отметок не теряются", async () => {
    /* На случай непроехавшей миграции: проект, у которого в базе остались
       номера, продолжает считаться, а не обнуляется. */
    prismaMock.partnerProject.findUnique.mockResolvedValue(row({
      id: "p1", name: "Сайт", ownerId: "client", status: "IN_PROGRESS", stepsDone: [0, 1], service: null,
    }));
    await patch({ steps: ["site-3"] });
    const args = prismaMock.partnerProject.update.mock.calls[0]![0] as unknown as { data: { stepsDone: string[] } };
    expect(args.data.stepsDone).toEqual(["site-1", "site-2", "site-3"]);
  });
});
