import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Тесты TZ.Connect.
 *
 * Два окружения в одном прогоне:
 *   node   — src/lib/** и маршруты src/app/api/** (серверный код, БД мокается);
 *   jsdom  — src/components/** (нужен DOM).
 *
 * Почему Vitest, а не Jest: проект на ESM и TypeScript, dev/start идут через
 * tsx, сборка — через Next с esbuild/SWC. Vitest берёт тот же esbuild и не
 * требует отдельного слоя транспиляции, babel-конфига и ts-jest.
 *
 * База данных в юнит-тестах не поднимается: `@/lib/prisma` подменяется через
 * vitest-mock-extended (см. src/test/prismaMock.ts). Реальная база нужна лишь
 * для интеграционных проверок прав — как её поднять, написано в
 * docs/testing-setup.md.
 */

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

/**
 * Общий пакет `@trioz/shared` в package.json указывает на собранный `dist`.
 * Тесты собирать пакет не должны: в чистом клоне `dist` ещё нет, и любой тест
 * маршрута, который импортирует имена сокет-событий, падал бы на «модуль не
 * найден» — не потому, что в нём ошибка, а потому что не запускали сборку.
 * Поэтому в тестах пакет разрешается прямо в исходники: те же константы, без
 * второй копии контракта.
 */
const sharedDir = fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url));

/** Совпадает с путями из tsconfig.json: "@/*" → "./src/*". */
const alias = { "@": srcDir, "@trioz/shared": sharedDir };

export default defineConfig({
  test: {
    globals: true,
    // Пути к покрытию и отчётам считаются от apps/web независимо от того,
    // откуда запущен vitest (из корня монорепы или из пакета).
    root: fileURLToPath(new URL(".", import.meta.url)),
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          globals: true,
          include: ["src/lib/**/*.test.ts", "src/app/api/**/*.test.ts", "src/test/**/*.test.ts"],
        },
      },
      {
        /**
         * Агент VPN-узла живёт вне apps/web и намеренно написан на голом ESM без
         * сборки и зависимостей. Его чистая часть — разбор вывода WireGuard и
         * построение команд iptables — всё равно должна быть под тестами: именно
         * там пряталась поломка закрепления внешних адресов. Отдельный проект,
         * потому что путей «@/» и окружения Next там нет и не нужно.
         */
        test: {
          name: "vpn-agent",
          environment: "node",
          globals: true,
          root: fileURLToPath(new URL("../vpn", import.meta.url)),
          include: ["src/**/*.test.mjs"],
        },
      },
      {
        /**
         * Десктоп-оболочка. Проверяется только её чистая часть: правила
         * навигации (что открывать внутри окна, что снаружи, а что не открывать
         * вовсе), имена и вытеснение в кеше картинок, вид кнопки обновления.
         *
         * Всё это раньше было заперто внутри модулей, которые импортируют
         * electron, — а его в тестовой среде нет. Логика вынесена в src/shared,
         * и теперь единственное, что осталось непокрытым, — работа с самим
         * окном и диском, которую без запущенного Electron всё равно не
         * проверить.
         */
        resolve: { alias },
        test: {
          name: "desktop-shell",
          environment: "node",
          globals: true,
          root: fileURLToPath(new URL("../desktop", import.meta.url)),
          include: ["src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "jsdom",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test/setupDom.ts"],
          /* Хуки лежат отдельно от компонентов, но это тот же клиентский код и
             то же окружение: без DOM их не проверить. Без этой строки тест
             рядом с хуком просто не запускался бы — и молча. */
          include: [
            "src/components/**/*.test.ts",
            "src/components/**/*.test.tsx",
            "src/hooks/**/*.test.ts",
            "src/hooks/**/*.test.tsx",
          ],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      // Считаем покрытие только по тому, что вообще под тестами: иначе цифра
      // размывается двумя сотнями непокрытых экранов и перестаёт что-то значить.
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "src/lib/prisma.ts"],
    },
  },
});
