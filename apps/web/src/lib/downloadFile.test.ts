/**
 * Сборка адреса скачивания.
 *
 * Здесь проверяется только `downloadUrl`, и это намеренно. `startFileDownload`
 * на три четверти состоит из веток по среде исполнения (WebView Android,
 * Electron, обычный браузер), и проверять его в node-проекте значило бы писать
 * тест на собственные заглушки: измерялась бы аккуратность моков, а не поведение
 * продукта. А вот адрес — чистая функция, и ошибка в нём ломает скачивание сразу
 * во всех трёх средах одинаково.
 */

import { describe, expect, it } from "vitest";
import { downloadUrl } from "./downloadFile";

describe("downloadUrl", () => {
  // ─── Разделитель параметров ───

  it("добавляет dl=1 через ? к адресу без параметров", () => {
    expect(downloadUrl("/uploads/documents/a.pdf")).toBe("/uploads/documents/a.pdf?dl=1");
  });

  /* ИНВАРИАНТ: если в адресе уже есть вопросительный знак, второй сделал бы
     всю хвостовую часть частью значения первого параметра, и сервер не увидел бы
     dl=1 вовсе — файл открылся бы в вкладке вместо скачивания. */
  it("добавляет dl=1 через & к адресу с параметрами", () => {
    expect(downloadUrl("/uploads/messages/a.webp?v=2")).toBe("/uploads/messages/a.webp?v=2&dl=1");
  });

  // ─── Имя файла ───

  it("не добавляет name, если имя не передано", () => {
    expect(downloadUrl("/uploads/documents/a.pdf")).not.toContain("name=");
  });

  it("не добавляет name для пустой строки", () => {
    expect(downloadUrl("/uploads/documents/a.pdf", "")).toBe("/uploads/documents/a.pdf?dl=1");
  });

  /* ИНВАРИАНТ: имя уходит закодированным. В TrioZ имена чаще всего русские и
     с пробелами; без кодирования пробел рвёт строку запроса, а амперсанд в имени
     добавляет чужой параметр. */
  it("кодирует имя с кириллицей и пробелами", () => {
    const url = downloadUrl("/uploads/documents/a.pdf", "Отчёт за май.pdf");
    expect(url).toBe(`/uploads/documents/a.pdf?dl=1&name=${encodeURIComponent("Отчёт за май.pdf")}`);
    expect(url).not.toContain(" ");
  });

  it("кодирует служебные символы в имени", () => {
    const url = downloadUrl("/uploads/documents/a.zip", "a&b=c d.zip");
    expect(url).toContain("name=a%26b%3Dc%20d.zip");
  });

  it("сочетает уже есть параметры и имя", () => {
    expect(downloadUrl("/uploads/documents/a.rar?token=1", "архив.rar")).toBe(
      `/uploads/documents/a.rar?token=1&dl=1&name=${encodeURIComponent("архив.rar")}`,
    );
  });
});
