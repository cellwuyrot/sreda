/**
 * Тесты: ключи и вытеснение кеша картинок.
 *
 * Кеш работает молча — тем и опасен. Проверяется ровно то, что ломается без
 * единой ошибки на экране: имя файла, собранное из чужого адреса, и порядок
 * вытеснения.
 */
import { describe, it, expect } from "vitest";
import {
  cacheKeyFor,
  evictionPlan,
  extensionOf,
  imageTypeFor,
  isSafeCacheKey,
  type CacheEntry,
} from "./mediaKeys";

describe("расширение и тип", () => {
  it("расширение приводится к нижнему регистру", () => {
    expect(extensionOf("/uploads/A1.PNG")).toBe(".png");
    expect(extensionOf("/uploads/файл.JPEG")).toBe(".jpeg");
  });

  it("без точки расширения нет", () => {
    expect(extensionOf("/uploads/noext")).toBe("");
    expect(imageTypeFor("/uploads/noext")).toBeNull();
  });

  it("ИНВАРИАНТ: не картинка не кешируется", () => {
    /* Кеш живёт вечно и раздаётся с диска: попади туда документ или ответ API,
       человек увидел бы вчерашние данные вместо сегодняшних. */
    for (const name of ["/uploads/a.pdf", "/uploads/a.mp4", "/uploads/a.html", "/uploads/a.json"]) {
      expect(imageTypeFor(name), name).toBeNull();
    }
    expect(imageTypeFor("/uploads/a.webp")).toBe("image/webp");
  });
});

describe("имя файла в кеше", () => {
  it("одинаковый адрес — одинаковое имя, разный — разное", () => {
    const a = cacheKeyFor("https://x.tld/uploads/1.png", ".png");
    expect(cacheKeyFor("https://x.tld/uploads/1.png", ".png")).toBe(a);
    expect(cacheKeyFor("https://x.tld/uploads/2.png", ".png")).not.toBe(a);
  });

  it("ФИКСАЦИЯ: один и тот же путь на разных серверах — разные файлы", () => {
    /* Имя считается от полного адреса. Считай мы от пути — картинка с одного
       сервера подменяла бы картинку с другого. */
    expect(cacheKeyFor("https://a.tld/uploads/1.png", ".png")).not.toBe(
      cacheKeyFor("https://b.tld/uploads/1.png", ".png"),
    );
  });

  it("ИНВАРИАНТ: имя из адреса не выводит за пределы каталога", () => {
    /* Имя приходит снаружи, по нему открывается файл на диске. Пропустив `../`,
       кеш начал бы читать и стирать чужие файлы. */
    for (const bad of [
      "../../etc/passwd",
      "aaaa/../../x.png",
      "/absolute/path.png",
      "невалидное.png",
      "ABCDEF0123456789abcdef0123456789abcdef01.png".toUpperCase(),
    ]) {
      expect(isSafeCacheKey(bad), bad).toBe(false);
    }
    expect(isSafeCacheKey(cacheKeyFor("https://x.tld/1.png", ".png"))).toBe(true);
  });
});

describe("вытеснение", () => {
  const entries: CacheEntry[] = [
    { key: "старый", size: 40, atime: 100 },
    { key: "средний", size: 40, atime: 200 },
    { key: "свежий", size: 40, atime: 300 },
  ];

  it("в пределах лимита не удаляется ничего", () => {
    expect(evictionPlan(entries, 120, 200)).toEqual([]);
  });

  it("ИНВАРИАНТ: первым уходит самое давно не нужное", () => {
    /* Ошибка в сравнении выбросила бы то, чем только что пользовались: кеш
       занимает место и не ускоряет ничего. */
    expect(evictionPlan(entries, 120, 100)).toEqual(["старый"]);
    /* Не хватило одного — уходит следующий по давности, и так далее. */
    expect(evictionPlan(entries, 200, 100)).toEqual(["старый", "средний", "свежий"]);
  });

  it("ФИКСАЦИЯ: освобождаем с запасом, а не ровно до предела", () => {
    /* Иначе полный кеш вытесняет что-нибудь при каждой новой картинке и всё время
       работает на грани. При пределе 100 остановиться нужно на 80. */
    const plan = evictionPlan(entries, 120, 100);
    const freed = plan.length * 40;
    expect(120 - freed).toBeLessThanOrEqual(80);
  });

  it("пустой кеш не ломает расчёт", () => {
    expect(evictionPlan([], 0, 100)).toEqual([]);
  });
});
