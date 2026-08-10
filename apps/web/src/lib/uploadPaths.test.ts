/**
 * Тесты: src/lib/uploadPaths.ts — тип отдаваемого вложения и разбор адреса.
 *
 * Главное здесь: голосовое и видеосообщение имеют ОДНО расширение `.webm`.
 * Карта типов знает только расширение, поэтому видеозаметка уходила браузеру как
 * `audio/webm` — и `<video>`, получив звуковой тип, читал файл как звук: кадра
 * нет, на месте заметки пустой квадрат. Отсюда «нет превью, сломанная картинка».
 */
import { describe, it, expect } from "vitest";
import {
  parseByteRange,
  resolveUploadPath,
  uploadContentType,
  UPLOAD_MIME_TYPES,
} from "@/lib/uploadPaths";

// ─── Тип по папке и расширению ────────────────────────────────────────────────

describe("uploadContentType", () => {
  /**
   * ИНВАРИАНТ: видеозаметка отдаётся видео-типом. Расширения для этого
   * недостаточно — различать приходится по папке, куда её положил маршрут
   * загрузки.
   */
  it("ИНВАРИАНТ: .webm из папки videos — это video/webm", () => {
    expect(uploadContentType("videos", ".webm")).toBe("video/webm");
  });

  /**
   * ИНВАРИАНТ: голосовое остаётся звуком. Если «починить» карту в лоб, заменив
   * тип у расширения, голосовые начнут уходить как видео — и проигрыватель
   * покажет пустой прямоугольник вместо звуковой дорожки.
   */
  it("ИНВАРИАНТ: .webm из папки voice остаётся audio/webm", () => {
    expect(uploadContentType("voice", ".webm")).toBe("audio/webm");
  });

  it(".ogg тоже зависит от папки", () => {
    expect(uploadContentType("videos", ".ogg")).toBe("video/ogg");
    expect(uploadContentType("voice", ".ogg")).toBe("audio/ogg");
  });

  it("однозначные расширения от папки не зависят", () => {
    expect(uploadContentType("videos", ".mp4")).toBe("video/mp4");
    expect(uploadContentType("messages", ".webp")).toBe("image/webp");
    expect(uploadContentType("documents", ".pdf")).toBe("application/pdf");
  });

  it("регистр расширения не имеет значения: имя пришло от человека", () => {
    expect(uploadContentType("videos", ".WEBM")).toBe("video/webm");
    expect(uploadContentType("documents", ".PDF")).toBe("application/pdf");
  });

  it("неизвестное расширение — поток байт, а не догадки", () => {
    expect(uploadContentType("documents", ".xyz")).toBe("application/octet-stream");
    expect(uploadContentType("videos", "")).toBe("application/octet-stream");
  });

  it("шифрованное вложение остаётся потоком байт", () => {
    expect(uploadContentType("voice", ".enc")).toBe("application/octet-stream");
  });

  it("в карте есть и документы: без них они уходили потоком байт", () => {
    expect(UPLOAD_MIME_TYPES[".docx"]).toContain("wordprocessingml");
    expect(UPLOAD_MIME_TYPES[".txt"]).toContain("text/plain");
  });
});

// ─── Разбор адреса вложения ───────────────────────────────────────────────────

describe("resolveUploadPath", () => {
  it("обычный путь разбирается на папку и файл", () => {
    const resolved = resolveUploadPath("/uploads/videos/abc.webm");
    expect(resolved?.dir).toBe("videos");
    expect(resolved?.filePath).toMatch(/videos[\\/]abc\.webm$/);
  });

  it("папка videos приватная: заметки не должны лежать в открытом доступе", () => {
    expect(resolveUploadPath("/uploads/videos/abc.webm")?.isPrivate).toBe(true);
    expect(resolveUploadPath("/uploads/voice/abc.webm")?.isPrivate).toBe(true);
  });

  it("чужой адрес не разбирается", () => {
    expect(resolveUploadPath("/etc/passwd")).toBeNull();
    expect(resolveUploadPath("/uploads/")).toBeNull();
  });

  /**
   * ИНВАРИАНТ: выход из папки вложений недопустим — иначе по адресу вложения
   * можно прочитать любой файл на сервере.
   */
  it("ИНВАРИАНТ: попытка выйти вверх по дереву отбивается", () => {
    expect(resolveUploadPath("/uploads/videos/../../etc/passwd")).toBeNull();
    expect(resolveUploadPath("/uploads/../secrets/key")).toBeNull();
  });
});

// ─── Диапазоны байт ───────────────────────────────────────────────────────────

describe("parseByteRange", () => {
  it("без заголовка — файл целиком", () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange("", 1000)).toBeNull();
  });

  it("непонятный заголовок не ломает выдачу, а игнорируется", () => {
    expect(parseByteRange("bytes=abc", 1000)).toBeNull();
    expect(parseByteRange("items=0-10", 1000)).toBeNull();
    expect(parseByteRange("bytes=-", 1000)).toBeNull();
  });

  it("обычный кусок разбирается", () => {
    expect(parseByteRange("bytes=100-200", 1000)).toEqual({ start: 100, end: 200 });
  });

  /**
   * ИНВАРИАНТ: границы включительные. `bytes=0-0` — ровно один байт; если считать
   * их исключительными, каждый кусок окажется короче на байт, и проигрыватель
   * будет спотыкаться на стыках.
   */
  it("ИНВАРИАНТ: границы включительные", () => {
    expect(parseByteRange("bytes=0-0", 1000)).toEqual({ start: 0, end: 0 });
  });

  it("«с позиции до конца» — вторая граница подставляется", () => {
    expect(parseByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("«последние N байт» считаются от конца", () => {
    expect(parseByteRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
  });

  it("просьба хвоста длиннее файла даёт файл целиком", () => {
    expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("конец за пределами файла подрезается", () => {
    expect(parseByteRange("bytes=900-99999", 1000)).toEqual({ start: 900, end: 999 });
  });

  /**
   * ИНВАРИАНТ: запрос за пределами файла — 416, а не пустой ответ. Иначе
   * проигрыватель ждёт данные, которых не будет, и заметка «висит».
   */
  it("ИНВАРИАНТ: начало за пределами файла — unsatisfiable", () => {
    expect(parseByteRange("bytes=1000-1100", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });

  it("перевёрнутый диапазон — тоже unsatisfiable", () => {
    expect(parseByteRange("bytes=300-100", 1000)).toBe("unsatisfiable");
  });

  it("пустой файл диапазонов не имеет", () => {
    expect(parseByteRange("bytes=0-10", 0)).toBeNull();
  });

  it("пробелы вокруг заголовка не мешают", () => {
    expect(parseByteRange("  bytes=10-20  ", 1000)).toEqual({ start: 10, end: 20 });
  });
});
