/**
 * Общая заглушка Prisma для юнит-тестов.
 *
 * Юнит-тесту база не нужна: проверяется логика прав и переходов состояний, а
 * не то, умеет ли PostgreSQL делать JOIN. Поднимать базу ради этого — значит
 * получить медленный и хрупкий прогон, который падает от чужой миграции.
 *
 * Использование в файле теста — ДО импорта тестируемого модуля:
 *
 *   import { prismaMock } from "@/test/prismaMock";
 *   vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
 *   const { getChannelPermissions } = await import("@/lib/connectPermissions");
 *
 * Модули берут prisma и как "@/lib/prisma", и как "./prisma" — подменять нужно
 * тот путь, который написан в самом модуле (см. примеры в соседних тестах).
 */
import { beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

export const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

/**
 * Ряд таблицы для `mockResolvedValue`.
 *
 * Тип строки Prisma перечисляет все поля модели — их бывает под сорок, и почти
 * ни одно не участвует в проверке. Тест задаёт ровно те, которые читает код:
 * так видно, от чего поведение действительно зависит, и тест не приходится
 * править при каждом новом столбце в схеме.
 *
 * Компромисс на этом и заканчивается: он собран в одном месте и объяснён, а не
 * рассыпан по файлам тестов через `as any`. Правило
 * `@typescript-eslint/no-explicit-any` в проекте стоит на «error» осознанно, и
 * ослаблять его ради тестов — значит понижать планку ровно там, где её держат.
 *
 *   prismaMock.channel.findUnique.mockResolvedValue(row({ id: "c1", hidden: false }));
 */
export function row<T>(value: T): never {
  return value as never;
}

/** Готовая фабрика для vi.mock: `vi.mock("@/lib/prisma", prismaModuleMock)`. */
export const prismaModuleMock = () => ({ default: prismaMock, prisma: prismaMock });

export { vi };
