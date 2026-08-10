/**
 * Тесты: правила навигации десктоп-оболочки.
 *
 * Ошибка здесь тихая и неприятная: либо в окне мессенджера открывается витрина
 * сайта, либо чужая ссылка загружается прямо в приложение — вместе с сессией.
 * Ни то, ни другое не даёт ни ошибки, ни предупреждения, поэтому проверяется
 * именно граница: свой адрес против чужого и раздел приложения против раздела
 * сайта.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_START_PATH } from "./constants";
import {
  isBlockedInApp,
  isBlockedPath,
  isExternalUrl,
  isSameOriginDocument,
  safeInAppPath,
  sanitizeAppUrl,
} from "./navigation";

const APP = "https://connect.trioz.ru";

describe("разделы сайта в мессенджере", () => {
  it("витрина и разделы сайта закрыты, разделы приложения открыты", () => {
    expect(isBlockedPath("/")).toBe(true);
    expect(isBlockedPath("/library")).toBe(true);
    expect(isBlockedPath("/projects/alpha")).toBe(true);
    expect(isBlockedPath("/connect")).toBe(false);
    expect(isBlockedPath("/settings/notifications")).toBe(false);
  });

  it("ИНВАРИАНТ: запрет не обойти лишним символом в конце", () => {
    /* `/library/`, `/library?x=1` и `/library#top` — тот же раздел. Без
       обрезки любой из них проезжал бы мимо проверки. */
    for (const path of ["/library/", "/library?utm=1", "/library#top", "/library///"]) {
      expect(isBlockedPath(path), path).toBe(true);
    }
  });

  it("ФИКСАЦИЯ: похожий по началу путь не блокируется", () => {
    /* `/libraryX` — это не `/library`: сравнение по началу строки без границы
       закрыло бы чужой раздел заодно. */
    expect(isBlockedPath("/libraryX")).toBe(false);
    expect(isBlockedPath("/perotest")).toBe(false);
  });

  it("закрытый путь подменяется началом приложения", () => {
    expect(safeInAppPath("/library")).toBe(DEFAULT_START_PATH);
    expect(safeInAppPath("/connect?section=dm")).toBe("/connect?section=dm");
  });
});

describe("что открывать снаружи", () => {
  it("чужой сайт — внешний, свой — нет", () => {
    expect(isExternalUrl("https://example.com/page", APP)).toBe(true);
    expect(isExternalUrl(`${APP}/connect`, APP)).toBe(false);
  });

  it("ИНВАРИАНТ: не-http схемы всегда наружу", () => {
    /* `file:` открыл бы локальный файл правами приложения, `mailto:` и `tel:`
       обязана обрабатывать система. */
    for (const url of ["file:///etc/passwd", "mailto:a@b.c", "tel:+70000000000", "trioz://invite/x"]) {
      expect(isExternalUrl(url, APP), url).toBe(true);
    }
  });

  it("ФИКСАЦИЯ: похожее имя узла — чужой адрес", () => {
    /* `connect.trioz.ru.evil.tld` начинается с нашего имени, но принадлежит
       кому-то другому. Сравнение идёт по источнику целиком, не по началу. */
    expect(isExternalUrl("https://connect.trioz.ru.evil.tld/", APP)).toBe(true);
    expect(isExternalUrl("http://connect.trioz.ru/connect", APP)).toBe(true); // другая схема — другой источник
  });

  it("мусор вместо адреса наружу не отправляется", () => {
    /* Загружать его всё равно некуда, а передавать браузеру незачем. */
    expect(isExternalUrl("не адрес", APP)).toBe(false);
  });

  it("свой сайт, но закрытый раздел — отдельный случай", () => {
    expect(isBlockedInApp(`${APP}/library`, APP)).toBe(true);
    expect(isBlockedInApp(`${APP}/connect`, APP)).toBe(false);
    // Чужой адрес сюда не относится: им занимается isExternalUrl.
    expect(isBlockedInApp("https://example.com/library", APP)).toBe(false);
  });
});

describe("переход полной загрузкой страницы", () => {
  it("обычный раздел — да", () => {
    expect(isSameOriginDocument(`${APP}/settings`, APP)).toBe(true);
  });

  it("ИНВАРИАНТ: вход, выход и API загрузкой страницы не идут", () => {
    /* Там меняется сессия: дерево обязано перезагрузиться целиком, и мягкая
       навигация оставила бы приложение с прежним пользователем на экране. */
    for (const path of ["/auth/signin", "/api/profile/me", "/download/app"]) {
      expect(isSameOriginDocument(`${APP}${path}`, APP), path).toBe(false);
    }
  });

  it("ФИКСАЦИЯ: файл — не раздел", () => {
    /* Ссылка на файл вызывает скачивание; перехватив её как переход, оболочка
       показала бы пустую страницу вместо файла. */
    expect(isSameOriginDocument(`${APP}/uploads/a1b2.png`, APP)).toBe(false);
    expect(isSameOriginDocument(`${APP}/docs/договор.pdf`, APP)).toBe(false);
  });

  it("чужой сайт — не наш переход", () => {
    expect(isSameOriginDocument("https://example.com/page", APP)).toBe(false);
  });
});

describe("адрес сервера из настроек", () => {
  it("нормальный адрес принимается, хвостовой слэш убирается", () => {
    expect(sanitizeAppUrl("https://connect.trioz.ru/", APP)).toBe("https://connect.trioz.ru");
    expect(sanitizeAppUrl("http://localhost:3005", APP)).toBe("http://localhost:3005");
  });

  it("ИНВАРИАНТ: не-http адрес отбрасывается", () => {
    /* Это значение подставляется в загрузку окна: `file:` открыл бы локальный
       файл с правами приложения. */
    expect(sanitizeAppUrl("file:///C:/", APP)).toBe(APP);
    expect(sanitizeAppUrl("javascript:alert(1)", APP)).toBe(APP);
  });

  it("пустое и неразбираемое дают запасной адрес, а не пустое окно", () => {
    expect(sanitizeAppUrl(undefined, APP)).toBe(APP);
    expect(sanitizeAppUrl("", APP)).toBe(APP);
    expect(sanitizeAppUrl("connect.trioz.ru", APP)).toBe(APP); // без схемы — не адрес
  });

  it("путь в адресе сохраняется", () => {
    /* Сервер может стоять не в корне домена. */
    expect(sanitizeAppUrl("https://example.com/tz", APP)).toBe("https://example.com/tz");
  });
});
