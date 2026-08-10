/**
 * Тесты: src/lib/attachmentTypes.ts
 *
 * Проверяется главное свойство нового модуля: решение о типе вложения принимается
 * не только по MIME. Именно опора на один MIME и была корнем жалобы «не грузятся
 * md и rar»: браузеры отдают для .md пустую строку или text/plain, а для .rar —
 * application/octet-stream, и белый список по MIME отклонял их оба.
 *
 * Вторая проверяемая вещь — сигнатуры. Разрешить расширение мало: если бы мы
 * просто перестали смотреть внутрь файла, любой исполняемый файл проехал бы в
 * чат под именем report.rar.
 */
import { describe, it, expect } from "vitest";
import {
  CHAT_ATTACHMENT_ACCEPT,
  documentSignatureError,
  fileExtension,
  resolveAttachment,
} from "@/lib/attachmentTypes";

describe("fileExtension", () => {
  it("берёт расширение в нижнем регистре", () => {
    expect(fileExtension("README.MD")).toBe("md");
    expect(fileExtension("архив.часть1.rar")).toBe("rar");
  });

  it("файл без точки расширения не имеет", () => {
    expect(fileExtension("Makefile")).toBe("");
  });
});

describe("resolveAttachment", () => {
  /**
   * ИНВАРИАНТ: пустой или обезличенный MIME не повод отказать, если расширение
   * известно. Именно так ведёт себя Windows с .md и .rar.
   */
  it("md без MIME разрешён по расширению", () => {
    const r = resolveAttachment("", "notes.md");
    expect(r.allowed).toBe(true);
    expect(r.kind).toBe("document");
  });

  it("rar под application/octet-stream разрешён", () => {
    const r = resolveAttachment("application/octet-stream", "archive.rar");
    expect(r.allowed).toBe(true);
    expect(r.extension).toBe("rar");
  });

  it("zip по-прежнему разрешён", () => {
    expect(resolveAttachment("application/zip", "pack.zip").allowed).toBe(true);
  });

  it("картинка узнаётся как картинка, а не как документ", () => {
    expect(resolveAttachment("image/png", "shot.png").kind).toBe("image");
  });

  /**
   * ИНВАРИАНТ: расширение как фоллбэк — это не «разрешить всё». Исполняемые
   * файлы и скрипты обязаны отклоняться так же, как до правки.
   */
  it("исполняемый файл отклоняется", () => {
    expect(resolveAttachment("application/octet-stream", "setup.exe").allowed).toBe(false);
    expect(resolveAttachment("text/x-sh", "run.sh").allowed).toBe(false);
  });
});

describe("CHAT_ATTACHMENT_ACCEPT", () => {
  /**
   * Клиентский accept и серверный список разошлись именно потому, что их было два.
   * Теперь строка одна и собирается из того же списка расширений.
   */
  it("содержит всё, что разрешает сервер", () => {
    for (const ext of [".md", ".rar", ".zip", ".pdf", ".docx", ".txt"]) {
      expect(CHAT_ATTACHMENT_ACCEPT).toContain(ext);
    }
    expect(CHAT_ATTACHMENT_ACCEPT).toContain("image/*");
  });
});

describe("documentSignatureError", () => {
  const rar4 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
  const rar5 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  const pdf = Buffer.from("%PDF-1.7\n", "latin1");

  it("настоящий rar проходит и в старом, и в новом формате", () => {
    expect(documentSignatureError("rar", rar4)).toBeNull();
    expect(documentSignatureError("rar", rar5)).toBeNull();
  });

  /**
   * ИНВАРИАНТ того самого бага: раньше rar проверялся сигнатурой zip и потому
   * отклонялся всегда. Сигнатуры теперь разные и не путаются.
   */
  it("zip не выдаёт себя за rar и наоборот", () => {
    expect(documentSignatureError("rar", zip)).not.toBeNull();
    expect(documentSignatureError("zip", rar4)).not.toBeNull();
    expect(documentSignatureError("zip", zip)).toBeNull();
  });

  it("pdf проверяется как и раньше", () => {
    expect(documentSignatureError("pdf", pdf)).toBeNull();
    expect(documentSignatureError("pdf", zip)).not.toBeNull();
  });

  /**
   * У md сигнатуры нет и быть не может: это обычный текст. Требовать её значило бы
   * вернуться к тому же отказу, только с другой формулировкой.
   */
  it("текстовые форматы не проверяются сигнатурой", () => {
    expect(documentSignatureError("md", Buffer.from("# Заголовок\n", "utf8"))).toBeNull();
    expect(documentSignatureError("txt", Buffer.from("просто текст", "utf8"))).toBeNull();
  });
});
