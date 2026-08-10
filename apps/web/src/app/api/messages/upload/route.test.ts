/**
 * Тесты: POST /api/messages/upload — разбор типа файла.
 *
 * Здесь проверяется ровно то, на чём сломались видеосообщения и голосовые:
 * `MediaRecorder` отдаёт тип ВМЕСТЕ с кодеками (`video/webm;codecs=vp9` —
 * проверено в браузере), и именно эта строка уходит как Content-Type части
 * запроса. Маршрут сверял её со списком разрешённых точным равенством и отвечал
 * 415, то есть запись не отправлялась вовсе.
 *
 * Тест написан так, чтобы падать при возврате прежнего поведения: если кто-то
 * снова начнёт сравнивать `file.type` целиком, эти проверки покраснеют.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/premium", () => ({ hasPremium: () => true }));
vi.mock("@/lib/fileValidation", () => ({ validateImageMagicBytes: () => true }));
vi.mock("@/lib/connectPermissions", () => ({
  canAccessConversation: vi.fn().mockResolvedValue(true),
  getChannelPermissions: vi.fn().mockResolvedValue({ canUpload: true }),
}));
vi.mock("@/lib/uploadPaths", () => ({ uploadDirRoot: (dir: string) => `/tmp/uploads-test/${dir}` }));

const recordUpload = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/uploadAccess", () => ({ recordUpload: (...a: unknown[]) => recordUpload(...a) }));

/* Диск не трогаем: тест о разборе типа, а не о записи файла. */
const writeFile = vi.fn().mockResolvedValue(undefined);
vi.mock("fs/promises", () => ({
  writeFile: (...a: unknown[]) => writeFile(...a),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

/* sharp тянет нативный модуль и нужен только картинкам. */
vi.mock("sharp", () => ({
  default: () => ({
    resize: () => ({ webp: () => ({ toBuffer: async () => Buffer.from("webp") }) }),
  }),
}));
vi.mock("uuid", () => ({ v4: () => "file-id" }));

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

const URL_UPLOAD = "http://localhost/api/messages/upload";

beforeEach(() => {
  mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "USER" } } as never);
  writeFile.mockClear();
  recordUpload.mockClear();
});

/** Запрос с одним файлом заданного типа. */
async function upload(type: string, extra: Record<string, string> = {}) {
  const fd = new FormData();
  /* Байты не важны: проверок содержимого у видео и звука нет, а картинки
     подменены заглушкой. */
  fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "note.webm", { type }), "note.webm");
  fd.append("conversationId", "conv-1");
  for (const [key, value] of Object.entries(extra)) fd.append(key, value);
  const req = new Request(URL_UPLOAD, { method: "POST", body: fd });
  const { POST } = await import("@/app/api/messages/upload/route");
  const res = await POST(req as unknown as import("next/server").NextRequest);
  return { status: res.status, body: await res.json() };
}

// ─── Тип с кодеками ──────────────────────────────────────────────────────────

describe("тип файла с кодеками", () => {
  /**
   * ИНВАРИАНТ: запись с камеры принимается. Именно этот случай и был сломан:
   * `video/webm;codecs=vp9` не совпадал со строкой `video/webm` из списка.
   */
  it("ИНВАРИАНТ: video/webm;codecs=vp9 принимается как видео", async () => {
    const { status, body } = await upload("video/webm;codecs=vp9");
    expect(status).toBe(200);
    expect(body.isVideo).toBe(true);
  });

  it("video/webm;codecs=vp8,opus — тоже видео", async () => {
    const { body } = await upload("video/webm;codecs=vp8,opus");
    expect(body.isVideo).toBe(true);
  });

  /**
   * ИНВАРИАНТ: голосовые ломались так же — `audio/webm;codecs=opus`. Отправка
   * молча не срабатывала, потому что клиент ошибку не показывал.
   */
  it("ИНВАРИАНТ: audio/webm;codecs=opus принимается как голос", async () => {
    const { status, body } = await upload("audio/webm;codecs=opus");
    expect(status).toBe(200);
    expect(body.isVoice).toBe(true);
  });

  it("тип без параметров работает как раньше", async () => {
    const { body } = await upload("video/webm");
    expect(body.isVideo).toBe(true);
  });

  it("верхний регистр не мешает: тип присылает клиент", async () => {
    const { body } = await upload("VIDEO/WEBM");
    expect(body.isVideo).toBe(true);
  });

  it("пробелы вокруг параметров не мешают", async () => {
    const { body } = await upload("video/webm ; codecs=vp9");
    expect(body.isVideo).toBe(true);
  });
});

// ─── Что осталось запрещённым ────────────────────────────────────────────────

describe("запрещённые типы", () => {
  it("исполняемый файл — 415", async () => {
    const { status } = await upload("application/x-msdownload");
    expect(status).toBe(415);
  });

  /**
   * ИНВАРИАНТ: обрезка параметров не должна превращаться в «принимаем всё».
   * Кодеки отбрасываются, но сам контейнер по-прежнему обязан быть в списке.
   */
  it("ИНВАРИАНТ: неизвестный контейнер с кодеками всё равно 415", async () => {
    const { status } = await upload("video/x-flv;codecs=vp9");
    expect(status).toBe(415);
  });

  it("пустой тип — 415", async () => {
    const { status } = await upload("");
    expect(status).toBe(415);
  });
});

// ─── Как файл ложится на диск ────────────────────────────────────────────────

describe("расширение и тип в ответе", () => {
  /**
   * ИНВАРИАНТ: webm-заметка обязана лечь на диск как .webm. Расширение тоже
   * считалось по полному типу, поэтому запись с кодеками, даже пройди она
   * проверку, сохранилась бы как .mp4 — и не открылась бы.
   */
  it("ИНВАРИАНТ: webm с кодеками сохраняется как .webm, а не .mp4", async () => {
    const { body } = await upload("video/webm;codecs=vp9");
    expect(body.url).toMatch(/\.webm$/);
    const written = writeFile.mock.calls[0]?.[0] as string;
    expect(written).toMatch(/\.webm$/);
  });

  it("голос с кодеками тоже сохраняется как .webm", async () => {
    const { body } = await upload("audio/webm;codecs=opus");
    expect(body.url).toMatch(/\.webm$/);
  });

  it("в ответе тип без параметров: во вложении «;codecs=vp9» ни к чему", async () => {
    const { body } = await upload("video/webm;codecs=vp9");
    expect(body.type).toBe("video/webm");
  });

  it("видео кладётся в свою папку, голос — в свою", async () => {
    const video = await upload("video/webm;codecs=vp9");
    expect(video.body.url).toContain("/uploads/videos/");
    const voice = await upload("audio/webm;codecs=opus");
    expect(voice.body.url).toContain("/uploads/voice/");
  });
});

// ─── Пометка видеосообщения ──────────────────────────────────────────────────

describe("признак видеосообщения", () => {
  it("note=1 у видео даёт isVideoNote", async () => {
    const { body } = await upload("video/webm;codecs=vp9", { note: "1" });
    expect(body.isVideoNote).toBe(true);
  });

  it("без note обычное видео квадратом не становится", async () => {
    const { body } = await upload("video/webm;codecs=vp9");
    expect(body.isVideoNote).toBeUndefined();
  });

  /**
   * ИНВАРИАНТ: голос не может притвориться видеосообщением — иначе получатель
   * увидел бы квадрат, в котором нечего показывать.
   */
  it("ИНВАРИАНТ: note=1 у звука не даёт isVideoNote", async () => {
    const { body } = await upload("audio/webm;codecs=opus", { note: "1" });
    expect(body.isVideoNote).toBeUndefined();
    expect(body.isVoice).toBe(true);
  });

  it("длительность из запроса доезжает до вложения", async () => {
    const { body } = await upload("video/webm;codecs=vp9", { note: "1", duration: "12" });
    expect(body.duration).toBe(12);
  });
});
