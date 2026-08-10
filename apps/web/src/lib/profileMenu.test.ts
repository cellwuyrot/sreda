/**
 * Тесты: src/lib/profileMenu.ts — своё меню человека на телефоне.
 *
 * Зачем это появилось: в приложении не было ни профиля, ни центра уведомлений, ни
 * рабочей среды — попасть туда было неоткуда, а рядом с «Присоединиться» стояла
 * кнопка «Друзья», повторявшая раздел из нижней навигации. У партнёра не было
 * личного кабинета, у редактора и администратора — их разделов.
 *
 * Здесь проверяется состав меню по роли: место, где легче всего забыть роль или
 * показать чужой раздел.
 */
import { describe, it, expect } from "vitest";
import { profileMenuEntries } from "@/lib/profileMenu";
import { isAllowedShellPath } from "@/lib/shell";

function hrefs(role?: string | null): string[] {
  return profileMenuEntries(role).map((entry) => entry.href);
}

describe("общие пункты", () => {
  /**
   * ИНВАРИАНТ: профиль, уведомления и рабочая среда есть у каждого. Именно их
   * отсутствие и было багом: на телефоне до них нельзя было добраться.
   */
  it("ИНВАРИАНТ: у обычного человека есть профиль, уведомления и рабочая среда", () => {
    expect(hrefs("USER")).toEqual(["/settings", "/settings/notifications", "/workspace"]);
  });

  it("без роли — тот же общий набор", () => {
    expect(hrefs(undefined)).toEqual(["/settings", "/settings/notifications", "/workspace"]);
    expect(hrefs(null)).toEqual(["/settings", "/settings/notifications", "/workspace"]);
  });

  it("незнакомая роль не ломает меню и не открывает лишнего", () => {
    expect(hrefs("МАРСИАНИН")).toEqual(["/settings", "/settings/notifications", "/workspace"]);
  });
});

describe("разделы по роли", () => {
  /** ИНВАРИАНТ: у партнёра есть личный кабинет — его как раз и не было. */
  it("ИНВАРИАНТ: партнёр видит личный кабинет", () => {
    expect(hrefs("CONSULTANT")).toContain("/partner");
  });

  it("ИНВАРИАНТ: редактор видит редакторскую", () => {
    expect(hrefs("EDITOR")).toContain("/editor");
  });

  it("ИНВАРИАНТ: администратор видит свою панель", () => {
    expect(hrefs("ADMIN")).toContain("/admin");
  });

  /**
   * ИНВАРИАНТ: каждая роль видит РОВНО свой раздел и ничей больше.
   *
   * Первая версия показывала администратору ещё и редакторскую — с рассуждением о
   * полноте его прав. Это разошлось с остальным продуктом, где «Редакторская»
   * есть только у редактора: администратор ищет свою панель, а не второй похожий
   * раздел. Разнобой в том, что человек видит, дороже теоретической полноты прав.
   */
  it("ИНВАРИАНТ: администратор видит только свою панель", () => {
    expect(hrefs("ADMIN")).toContain("/admin");
    expect(hrefs("ADMIN")).not.toContain("/editor");
    expect(hrefs("ADMIN")).not.toContain("/partner");
  });

  it("ИНВАРИАНТ: редактор видит только редакторскую", () => {
    expect(hrefs("EDITOR")).toContain("/editor");
    expect(hrefs("EDITOR")).not.toContain("/admin");
    expect(hrefs("EDITOR")).not.toContain("/partner");
  });

  it("ИНВАРИАНТ: партнёр видит только свой кабинет", () => {
    expect(hrefs("CONSULTANT")).toContain("/partner");
    expect(hrefs("CONSULTANT")).not.toContain("/admin");
    expect(hrefs("CONSULTANT")).not.toContain("/editor");
  });

  it("ИНВАРИАНТ: у обычного аккаунта нет ни одного ролевого раздела", () => {
    expect(hrefs("USER")).not.toContain("/partner");
    expect(hrefs("USER")).not.toContain("/editor");
    expect(hrefs("USER")).not.toContain("/admin");
  });

  it("ролевой пункт всегда ровно один", () => {
    for (const role of ["CONSULTANT", "EDITOR", "ADMIN"]) {
      const roleOnly = profileMenuEntries(role).filter((entry) => entry.role);
      expect(roleOnly).toHaveLength(1);
      expect(roleOnly[0].role).toBe(role);
    }
  });
});

describe("связка с оболочкой", () => {
  /**
   * ИНВАРИАНТ И ЕСТЬ КОРЕНЬ БАГА: каждый пункт меню должен быть разрешён внутри
   * мобильной оболочки. Колокольчик на телефоне существовал, но вёл в
   * запрещённый путь — оболочка возвращала человека в мессенджер, и раздел
   * выглядел неработающим. Меню, ведущее в никуда, хуже отсутствия меню.
   */
  it("ИНВАРИАНТ: все пункты открываются внутри приложения", () => {
    for (const role of [null, "USER", "CONSULTANT", "EDITOR", "ADMIN"]) {
      for (const entry of profileMenuEntries(role)) {
        expect(isAllowedShellPath(entry.href), `${entry.href} должен быть разрешён в оболочке`).toBe(true);
      }
    }
  });

  it("у каждого пункта есть название и пояснение", () => {
    for (const entry of profileMenuEntries("ADMIN")) {
      expect(entry.label.length).toBeGreaterThan(3);
      expect(entry.hint.length).toBeGreaterThan(5);
    }
  });

  it("пункты не повторяются", () => {
    const list = hrefs("ADMIN");
    expect(new Set(list).size).toBe(list.length);
  });
});
