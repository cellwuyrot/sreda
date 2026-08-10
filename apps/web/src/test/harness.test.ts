/**
 * Проверка самой оснастки: алиас @/, окружение node, работающие моки.
 * Если этот файл красный — чинить надо конфигурацию, а не тесты зон.
 */
import { describe, it, expect } from "vitest";
import { prismaMock } from "@/test/prismaMock";

describe("оснастка тестов", () => {
  it("резолвит алиас @/ на src", () => {
    expect(prismaMock).toBeDefined();
  });

  it("глубокий мок Prisma отдаёт заданный ответ", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" } as never);
    await expect(prismaMock.user.findUnique({ where: { id: "u1" } })).resolves.toEqual({ id: "u1" });
  });

  it("работает в окружении node: есть process, нет window", () => {
    expect(typeof process.versions.node).toBe("string");
    expect(typeof globalThis.window).toBe("undefined");
  });
});
