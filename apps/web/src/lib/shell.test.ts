/**
 * Тесты: src/lib/shell.ts
 *
 * Проверяется навигационная политика оболочки и — главное — куда человек попадает
 * после входа. Здесь два риска: увести его на лендинг, которого в оболочке нет, и
 * увести на чужой сайт по адресу из строки запроса.
 */
import { describe, it, expect } from "vitest";
import {
  AUTH_FALLBACK_PATH,
  SHELL_HOME_PATH,
  isAllowedShellPath,
  resolveAuthRedirect,
} from "@/lib/shell";

// ─── Разрешённые пути оболочки ────────────────────────────────────────────────

describe("isAllowedShellPath", () => {
  it("мессенджер и его подразделы разрешены", () => {
    expect(isAllowedShellPath("/connect")).toBe(true);
    expect(isAllowedShellPath("/connect/services")).toBe(true);
  });

  it("вход разрешён: без него в мессенджер не попасть", () => {
    expect(isAllowedShellPath("/auth/signin")).toBe(true);
  });

  /**
   * ИНВАРИАНТ: сайтовые разделы в оболочке не открываются. Приложение заведено
   * ради мессенджера и собственных разделов человека, а не ради витрины сайта.
   */
  it("ИНВАРИАНТ: лендинг и сайтовые разделы не разрешены", () => {
    expect(isAllowedShellPath("/")).toBe(false);
    expect(isAllowedShellPath("/library")).toBe(false);
    expect(isAllowedShellPath("/projects")).toBe(false);
    expect(isAllowedShellPath("/games")).toBe(false);
    expect(isAllowedShellPath("/user/andrey")).toBe(false);
  });

  /**
   * ИНВАРИАНТ И ЕСТЬ ПРИЧИНА ПРАВКИ: собственные разделы человека в приложении
   * открываются. Без них в приложении не было ни профиля, ни центра уведомлений,
   * ни рабочей среды, а у партнёра, редактора и администратора — их разделов:
   * колокольчик существовал, но вёл в запрещённый путь, и оболочка возвращала
   * человека в мессенджер.
   */
  it("ИНВАРИАНТ: свои разделы человека разрешены", () => {
    expect(isAllowedShellPath("/settings")).toBe(true);
    expect(isAllowedShellPath("/settings/notifications")).toBe(true);
    expect(isAllowedShellPath("/workspace")).toBe(true);
    expect(isAllowedShellPath("/partner")).toBe(true);
    expect(isAllowedShellPath("/editor")).toBe(true);
    expect(isAllowedShellPath("/admin")).toBe(true);
    expect(isAllowedShellPath("/admin/appeals")).toBe(true);
  });

  it("строка запроса и якорь не мешают разбору", () => {
    expect(isAllowedShellPath("/connect?section=dm")).toBe(true);
    expect(isAllowedShellPath("/connect#top")).toBe(true);
  });
});

// ─── Куда идти после входа ────────────────────────────────────────────────────

describe("resolveAuthRedirect — обычный браузер", () => {
  it("без адреса — на главную сайта", () => {
    expect(resolveAuthRedirect(null, false)).toBe(AUTH_FALLBACK_PATH);
    expect(resolveAuthRedirect("", false)).toBe(AUTH_FALLBACK_PATH);
  });

  it("свой путь сохраняется вместе со строкой запроса", () => {
    expect(resolveAuthRedirect("/connect?section=dm", false)).toBe("/connect?section=dm");
  });

  it("сайтовый раздел в браузере сохраняется: там он существует", () => {
    expect(resolveAuthRedirect("/settings", false)).toBe("/settings");
  });
});

describe("resolveAuthRedirect — внутри оболочки", () => {
  /**
   * ИНВАРИАНТ: в оболочке после входа — только мессенджер. Лендинга там нет, и
   * человек, только что зарегистрировавшийся в приложении, попадал на главный
   * экран сайта и должен был искать вход в мессенджер сам.
   */
  it("ИНВАРИАНТ: без адреса — сразу в мессенджер, а не на лендинг", () => {
    expect(resolveAuthRedirect(null, true)).toBe(SHELL_HOME_PATH);
  });

  it("явно указанный лендинг тоже ведёт в мессенджер", () => {
    expect(resolveAuthRedirect("/", true)).toBe(SHELL_HOME_PATH);
  });

  it("сайтовый раздел в оболочке подменяется мессенджером: он там не откроется", () => {
    expect(resolveAuthRedirect("/library", true)).toBe(SHELL_HOME_PATH);
    expect(resolveAuthRedirect("/projects", true)).toBe(SHELL_HOME_PATH);
  });

  /**
   * ИНВАРИАНТ: после входа человека можно вернуть в его собственный раздел —
   * например, если он шёл в настройки и его попросили войти.
   */
  it("ИНВАРИАНТ: свой раздел человека сохраняется и в оболочке", () => {
    expect(resolveAuthRedirect("/settings/notifications", true)).toBe("/settings/notifications");
  });

  it("путь мессенджера сохраняется как есть", () => {
    expect(resolveAuthRedirect("/connect?section=business", true)).toBe("/connect?section=business");
  });

  it("приглашение в сообщество сохраняется: это часть флоу мессенджера", () => {
    expect(resolveAuthRedirect("/invite/abc123", true)).toBe("/invite/abc123");
  });
});

describe("resolveAuthRedirect — чужой адрес", () => {
  /**
   * ИНВАРИАНТ: адрес из строки запроса задаёт кто угодно, кто прислал ссылку.
   * Переход на чужой сайт сразу после успешного входа — готовая ловушка: там
   * человек введёт пароль второй раз, не задумываясь.
   */
  it("ИНВАРИАНТ: полный чужой адрес отбрасывается", () => {
    expect(resolveAuthRedirect("https://evil.example/login", false)).toBe(AUTH_FALLBACK_PATH);
    expect(resolveAuthRedirect("http://evil.example", true)).toBe(SHELL_HOME_PATH);
  });

  it("протокол-относительный адрес отбрасывается: «//host» ведёт наружу", () => {
    expect(resolveAuthRedirect("//evil.example", false)).toBe(AUTH_FALLBACK_PATH);
  });

  it("обратная косая черта отбрасывается: часть движков читает её как «//»", () => {
    expect(resolveAuthRedirect("/\\evil.example", false)).toBe(AUTH_FALLBACK_PATH);
  });

  it("скрипт вместо адреса отбрасывается", () => {
    expect(resolveAuthRedirect("javascript:alert(1)", false)).toBe(AUTH_FALLBACK_PATH);
  });

  it("пробелы вокруг адреса не помогают его протащить", () => {
    expect(resolveAuthRedirect("  https://evil.example  ", false)).toBe(AUTH_FALLBACK_PATH);
  });
});

describe("resolveAuthRedirect — петля входа", () => {
  /**
   * ИНВАРИАНТ: обратно на страницу входа не отправляем. Иначе успешный вход
   * приводит на форму входа, и человек решает, что вход не удался.
   */
  it("ИНВАРИАНТ: адрес страницы входа заменяется", () => {
    expect(resolveAuthRedirect("/auth/signin", false)).toBe(AUTH_FALLBACK_PATH);
    expect(resolveAuthRedirect("/auth/signin?x=1", true)).toBe(SHELL_HOME_PATH);
  });
});
