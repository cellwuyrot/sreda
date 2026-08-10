/**
 * Тесты: /api/workspace/upload — приём вложений рабочей среды.
 *
 * Через этот маршрут в хранилище попадают файлы, поэтому проверяется то, что
 * стоит дорого при ошибке:
 *
 *   • без входа не принимаем ничего;
 *   • тип и размер проверяются ДО записи на диск;
 *   • у файла заводится запись владельца — иначе он станет «неизвестным» и его
 *     раздача будет держаться только на факте входа;
 *   • общий холст канала: право писать в этот канал проверяется, иначе через
 *     загрузку можно положить файл в чужой канал.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn(async () => null) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => null) }));

const fs = { writeFile: vi.fn(async () => undefined), mkdir: vi.fn(async () => undefined) };
vi.mock("fs/promises", () => fs);

const recordUpload = vi.fn(async () => undefined);
vi.mock("@/lib/uploadAccess", () => ({ recordUpload: (...args: unknown[]) => recordUpload(...(args as [])) }));

const getChannelPermissions = vi.fn();
vi.mock("@/lib/connectPermissions", () => ({
  getChannelPermissions: (...args: unknown[]) => getChannelPermissions(...(args as [])),
}));

vi.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));

import { getServerSession } from "next-auth";
const mockSession = vi.mocked(getServerSession);

async function upload(fields: { type?: string; size?: number; channelId?: string; omitFile?: boolean } = {}) {
  const mod = await import("@/app/api/workspace/upload/route");
  const form = new FormData();
  if (!fields.omitFile) {
    const bytes = new Uint8Array(fields.size ?? 1024);
    form.append("file", new Blob([bytes], { type: fields.type ?? "image/png" }), "a.png");
  }
  if (fields.channelId) form.append("channelId", fields.channelId);

  const req = new Request("http://localhost/api/workspace/upload", { method: "POST", body: form });
  const res = await mod.POST(req as never);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  mockSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
  fs.writeFile.mockClear();
  recordUpload.mockClear();
  getChannelPermissions.mockReset().mockResolvedValue({ canPost: true });
});

describe("кто может загружать", () => {
  it("без входа — 401 и ни байта на диск", async () => {
    mockSession.mockResolvedValue(null);
    expect((await upload()).status).toBe(401);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("что принимаем", () => {
  it("картинка принимается, отдаётся адрес", async () => {
    const res = await upload({ type: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("/uploads/workspace/00000000-0000-4000-8000-000000000000.png");
  });

  it("PDF принимается: документы на доске — обычное дело", async () => {
    expect((await upload({ type: "application/pdf" })).status).toBe(200);
  });

  it("ИНВАРИАНТ: посторонний тип не попадает на диск", async () => {
    const res = await upload({ type: "application/x-msdownload" });
    expect(res.status).toBe(415);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ: слишком большой файл не попадает на диск", async () => {
    const res = await upload({ size: 13 * 1024 * 1024 });
    expect(res.status).toBe(413);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("пустой запрос отклоняется", async () => {
    expect((await upload({ omitFile: true })).status).toBe(400);
  });
});

describe("владелец файла", () => {
  it("ИНВАРИАНТ: у личного вложения записывается владелец и нет канала", async () => {
    /* Без записи владельца файл станет «неизвестным», и раздача будет держаться
       только на факте входа — то есть ссылка сработает у любого вошедшего. */
    await upload();
    expect(recordUpload).toHaveBeenCalledWith({
      path: "workspace/00000000-0000-4000-8000-000000000000.png",
      uploaderId: "u1",
      channelId: null,
    });
  });

  it("у вложения общего холста записывается канал — его видят участники", async () => {
    await upload({ channelId: "c1" });
    expect(recordUpload).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c1" }));
  });
});

describe("общий холст канала", () => {
  it("ИНВАРИАНТ: без права писать в канал файл туда не положить", async () => {
    getChannelPermissions.mockResolvedValue({ canPost: false });
    const res = await upload({ channelId: "чужой" });
    expect(res.status).toBe(403);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("канала нет — права канала и не спрашиваем", async () => {
    await upload();
    expect(getChannelPermissions).not.toHaveBeenCalled();
  });
});
