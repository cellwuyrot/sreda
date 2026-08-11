/**
 * PREMIUM-SKIN: тесты чистых функций своего оформления.
 *
 * Проект vitest — node: здесь нет ни DOM, ни React, проверяются только
 * функции без побочных эффектов. applyPremiumSkin и loadPremiumSkin трогают
 * document и localStorage, поэтому сюда не входят.
 *
 * Главное, что здесь зафиксировано: раздел «Обои» убран, и старая запись
 * в localStorage с полем wallpaper не должна ни падать, ни воскресать его:
 * у тех, кто успел поставить обои, поле просто тихо отбрасывается.
 */

import { describe, it, expect } from "vitest";
import {
  PREMIUM_SKIN_DEFAULT,
  normalizePremiumSkin,
  defaultPremiumSkin,
  sanitizeColor,
  sanitizeAssetUrl,
  sanitizeFontName,
  backgroundLayer,
  backgroundSize,
  backgroundRepeat,
  fontStack,
  fontFaceRule,
  hexToRgba,
  isPremiumSkinDefault,
} from "./premiumSkin";

describe("premiumSkin: структура", () => {
  it("в настройке остались только три части и общий выключатель", () => {
    expect(Object.keys(defaultPremiumSkin()).sort()).toEqual(["chat", "enabled", "font", "palette"]);
  });

  it("defaultPremiumSkin отдаёт копию, а не общий объект", () => {
    const a = defaultPremiumSkin();
    a.chat.dim = 70;
    expect(PREMIUM_SKIN_DEFAULT.chat.dim).not.toBe(70);
  });
});

describe("premiumSkin: старые записи с обоями", () => {
  const legacy = normalizePremiumSkin({
    enabled: true,
    chat: { mode: "image", imageUrl: "/uploads/documents/a.png", fit: "tile", dim: 40 },
    wallpaper: { mode: "image", imageUrl: "/uploads/documents/wall.png", dim: 20 },
    palette: { enabled: true, accent: "#ff0000" },
  });

  it("ПОЛЕ wallpaper отбрасывается молча", () => {
    expect("wallpaper" in legacy).toBe(false);
  });

  it("остальные настройки человека не теряются", () => {
    expect(legacy.chat.imageUrl).toBe("/uploads/documents/a.png");
    expect(legacy.chat.fit).toBe("tile");
    expect(legacy.chat.dim).toBe(40);
    expect(legacy.palette.accent).toBe("#ff0000");
  });
});

describe("premiumSkin: санитайзеры", () => {
  it("цвет — только #rrggbb", () => {
    expect(sanitizeColor("#abcdef", "#000000")).toBe("#abcdef");
    expect(sanitizeColor("#abc", "#000000")).toBe("#000000");
    expect(sanitizeColor("red; background:url(x)", "#000000")).toBe("#000000");
  });

  it("адрес картинки — только /uploads/… или https://…", () => {
    expect(sanitizeAssetUrl("/uploads/documents/b.webp")).toBe("/uploads/documents/b.webp");
    expect(sanitizeAssetUrl("https://cdn.example.com/x.png")).toBe("https://cdn.example.com/x.png");
    expect(sanitizeAssetUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeAssetUrl('/uploads/a").png')).toBe("");
  });

  it("имя шрифта чистится от спецсимволов", () => {
    expect(sanitizeFontName("PT Sans 2")).toBe("PT Sans 2");
    expect(sanitizeFontName('Evil";}')).not.toContain('"');
  });
});

describe("premiumSkin: CSS-слои фона чата", () => {
  const image = { mode: "image", color: "#123456", imageUrl: "/uploads/documents/c.jpg", fit: "tile", dim: 50 } as const;

  it("режим «как в теме» не даёт слоя", () => {
    expect(backgroundLayer({ ...image, mode: "theme" })).toBe("none");
  });

  it("затемнение ложится перед картинкой", () => {
    const layer = backgroundLayer(image);
    expect(layer).toContain('url("/uploads/documents/c.jpg")');
    expect(layer.indexOf("gradient")).toBeLessThan(layer.indexOf("url("));
  });

  it("плитка повторяется, cover растягивается", () => {
    expect(backgroundRepeat(image)).toBe("repeat");
    expect(backgroundSize({ ...image, fit: "cover" })).toBe("cover");
  });

  it("hexToRgba складывает прозрачность", () => {
    expect(hexToRgba("#000000", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
  });
});

describe("premiumSkin: шрифт", () => {
  it("@font-face нужен только своему файлу", () => {
    expect(fontFaceRule({ mode: "builtin", builtin: "inter", customName: "", customUrl: "" })).toBe("");
    const face = fontFaceRule({
      mode: "custom",
      builtin: "inter",
      customName: "My Font",
      customUrl: "https://cdn.example.com/f.woff2",
    });
    expect(face).toContain("@font-face");
    expect(face).toContain("My Font");
  });

  it("встроенный шрифт даёт непустой стек", () => {
    expect(fontStack({ mode: "builtin", builtin: "georgia", customName: "", customUrl: "" }).length).toBeGreaterThan(0);
  });
});

describe("premiumSkin: мусор на входе", () => {
  it("не роняет нормализацию и зажимает диапазоны", () => {
    const junk = normalizePremiumSkin({ enabled: "да", chat: "нет", palette: 5, font: null });
    expect(junk.chat.mode).toBe(PREMIUM_SKIN_DEFAULT.chat.mode);
    expect(normalizePremiumSkin({ chat: { dim: 900 } }).chat.dim).toBeLessThanOrEqual(85);
    expect(isPremiumSkinDefault(normalizePremiumSkin(undefined))).toBe(true);
  });
});
