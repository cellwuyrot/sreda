import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { amzDates, deleteObject, getObject, headObject, putObject, signObjectRequest, type StorageTarget } from "@/lib/objectStore";

/**
 * STORAGE-PRIORITY: подпись запроса к хранилищу.
 *
 * Подпись проверяется сравнением строк, а не попаданием в живое хранилище:
 * ошибка здесь даёт один и тот же отказ на любую причину, и разбирать её по
 * ответу сервера невозможно.
 */

const target: StorageTarget = {
  endpoint: "https://files1.example.ru:9000",
  bucket: "trioz",
  region: "ru-1",
  keyId: "AKIAEXAMPLE",
  secret: "секрет-хранилища",
};

const NOW = new Date("2026-05-01T10:20:30.000Z");

describe("STORAGE-PRIORITY: подпись", () => {
  it("время раскладывается в два вида, которых требует протокол", () => {
    expect(amzDates(NOW)).toEqual({ amzDate: "20260501T102030Z", dateStamp: "20260501" });
  });

  it("адрес собирается путём, а не поддоменом корзины", () => {
    const signed = signObjectRequest({ target, method: "GET", key: "messages/a.webp", now: NOW });
    expect(signed.url).toBe("https://files1.example.ru:9000/trioz/messages/a.webp");
  });

  it("подпись повторяема: те же данные — та же строка", () => {
    const a = signObjectRequest({ target, method: "GET", key: "messages/a.webp", now: NOW });
    const b = signObjectRequest({ target, method: "GET", key: "messages/a.webp", now: NOW });
    expect(a.headers.Authorization).toBe(b.headers.Authorization);
    expect(a.headers.Authorization).toContain("AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260501/ru-1/s3/aws4_request");
  });

  it("ФИКСАЦИЯ: подпись зависит от тела — подменённый файл её не пройдёт", () => {
    const one = signObjectRequest({ target, method: "PUT", key: "m/a", payload: Buffer.from("раз"), now: NOW });
    const two = signObjectRequest({ target, method: "PUT", key: "m/a", payload: Buffer.from("два"), now: NOW });
    expect(one.headers.Authorization).not.toBe(two.headers.Authorization);
    expect(one.headers["x-amz-content-sha256"]).not.toBe(two.headers["x-amz-content-sha256"]);
  });

  it("подпись зависит от метода, ключа и времени", () => {
    const base = signObjectRequest({ target, method: "GET", key: "m/a", now: NOW });
    const other = [
      signObjectRequest({ target, method: "DELETE", key: "m/a", now: NOW }),
      signObjectRequest({ target, method: "GET", key: "m/b", now: NOW }),
      signObjectRequest({ target, method: "GET", key: "m/a", now: new Date("2026-05-02T10:20:30.000Z") }),
    ];
    for (const variant of other) expect(variant.headers.Authorization).not.toBe(base.headers.Authorization);
  });

  it("ФИКСАЦИЯ: скобки в имени файла кодируются — иначе подпись не сойдётся", () => {
    /* encodeURIComponent оставляет !'()* как есть, а протокол требует их
       закодированными. Ловится только на таких именах, поэтому закреплено. */
    const signed = signObjectRequest({ target, method: "GET", key: "documents/отчёт (1).pdf", now: NOW });
    expect(signed.url).toContain("%281%29");
    expect(signed.url).not.toContain("(1)");
  });

  it("слэши в ключе остаются слэшами, а не превращаются в %2F", () => {
    const signed = signObjectRequest({ target, method: "GET", key: "a/b/c.txt", now: NOW });
    expect(signed.url).toBe("https://files1.example.ru:9000/trioz/a/b/c.txt");
  });

  it("Range уходит в подписанных заголовках, а не мимо неё", () => {
    const signed = signObjectRequest({
      target,
      method: "GET",
      key: "voice/a.webm",
      extraHeaders: { range: "bytes=10-20" },
      now: NOW,
    });
    expect(signed.headers.range).toBe("bytes=10-20");
    expect(signed.headers.Authorization).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
  });
});

describe("STORAGE-PRIORITY: обращения к хранилищу", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("запись отправляет тело и тип файла", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await putObject(target, "messages/a.webp", Buffer.from("данные"), "image/webp");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://files1.example.ru:9000/trioz/messages/a.webp");
    expect(init.method).toBe("PUT");
    expect(init.headers["content-type"]).toBe("image/webp");
  });

  it("ФИКСАЦИЯ: отказ хранилища — это ошибка, а не тихий успех", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await expect(putObject(target, "m/a", Buffer.from("x"), "text/plain")).rejects.toThrow(/403/);
  });

  it("частичный ответ 206 считается успехом чтения", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 206, headers: new Headers() });
    await expect(getObject(target, "voice/a.webm", "bytes=0-10")).resolves.toBeTruthy();
  });

  it("нет объекта — размер null, а не исключение", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, headers: new Headers() });
    await expect(headObject(target, "m/нет")).resolves.toBeNull();
  });

  it("удаление отсутствующего объекта ошибкой не считается", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    await expect(deleteObject(target, "m/нет")).resolves.toBeUndefined();
  });
});
