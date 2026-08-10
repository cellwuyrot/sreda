import { describe, it, expect } from "vitest";
import { hasPremium, premiumSource, PREMIUM_ROLE } from "@/lib/premium";

describe("PREMIUM_ROLE", () => {
  it("роль администратора — строка ADMIN", () => {
    expect(PREMIUM_ROLE).toBe("ADMIN");
  });
});

describe("hasPremium", () => {
  it("возвращает false для undefined", () => {
    expect(hasPremium(undefined)).toBe(false);
  });

  it("возвращает false для null", () => {
    expect(hasPremium(null)).toBe(false);
  });

  it("возвращает false при isPremium=false и роли не ADMIN", () => {
    expect(hasPremium({ isPremium: false, role: "USER" })).toBe(false);
  });

  it("возвращает false при isPremium=null и роли не ADMIN", () => {
    expect(hasPremium({ isPremium: null, role: "USER" })).toBe(false);
  });

  it("возвращает false при пустом объекте", () => {
    expect(hasPremium({})).toBe(false);
  });

  it("возвращает true при isPremium=true", () => {
    expect(hasPremium({ isPremium: true, role: "USER" })).toBe(true);
  });

  it("возвращает true при роли ADMIN без подписки", () => {
    expect(hasPremium({ isPremium: false, role: "ADMIN" })).toBe(true);
  });

  it("возвращает true при роли ADMIN и isPremium=null", () => {
    expect(hasPremium({ isPremium: null, role: "ADMIN" })).toBe(true);
  });

  it("возвращает true при роли ADMIN и isPremium=true", () => {
    expect(hasPremium({ isPremium: true, role: "ADMIN" })).toBe(true);
  });

  it("возвращает false при роли null и isPremium=false", () => {
    expect(hasPremium({ isPremium: false, role: null })).toBe(false);
  });

  it("роль чувствительна к регистру — admin (строчная) не даёт премиум", () => {
    expect(hasPremium({ isPremium: false, role: "admin" })).toBe(false);
  });
});

describe("premiumSource", () => {
  it("возвращает none для undefined", () => {
    expect(premiumSource(undefined)).toBe("none");
  });

  it("возвращает none для null", () => {
    expect(premiumSource(null)).toBe("none");
  });

  it("возвращает none при isPremium=false и обычной роли", () => {
    expect(premiumSource({ isPremium: false, role: "USER" })).toBe("none");
  });

  it("возвращает none при пустом объекте", () => {
    expect(premiumSource({})).toBe("none");
  });

  it("возвращает role при роли ADMIN (даже без подписки)", () => {
    expect(premiumSource({ isPremium: false, role: "ADMIN" })).toBe("role");
  });

  it("возвращает role при роли ADMIN и isPremium=true (роль имеет приоритет)", () => {
    expect(premiumSource({ isPremium: true, role: "ADMIN" })).toBe("role");
  });

  it("возвращает subscription при isPremium=true и обычной роли", () => {
    expect(premiumSource({ isPremium: true, role: "USER" })).toBe("subscription");
  });

  it("возвращает subscription при isPremium=true и роли null", () => {
    expect(premiumSource({ isPremium: true, role: null })).toBe("subscription");
  });
});
