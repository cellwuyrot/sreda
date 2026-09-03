/**
 * Матчеры вроде toBeInTheDocument для проекта jsdom.
 *
 * Матчеры подключаются вручную, а не готовым входом `jest-dom/vitest`. Причина
 * в разрешении модулей: `@testing-library/jest-dom` в этой монорепе поднимается
 * в корневой node_modules, а `vitest` остаётся в apps/web — и его собственный
 * `import "vitest"` не находил пакет вовсе. Падал не отдельный тест, а весь
 * проект jsdom: «Cannot find package 'vitest'» ещё до сбора файлов. Здесь же
 * `vitest` разрешается от этого файла, то есть от apps/web, где он и стоит.
 */
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);
