# Протокол проверок — 2026-10-27

Среда: Linux, Node.js 24.22.1, npm 11.19.1, Vitest 3.2.7, Next.js 16.2.10, Prisma 5.22.0; локальный Chromium 153.0.8010.12. CI использует Node 20; сам удалённый CI pipeline из этой среды не запускался.

| Проверка | Результат | Доказательство |
| --- | --- | --- |
| `npm run test -w apps/web -- --maxWorkers=2` | **PASS: 2356/2356, 168/168 файлов; 0 failed, 0 skipped; exit 0** | `checks/vitest-full.txt` |
| `npm run typecheck -w apps/web` | **PASS, exit 0**, production tsconfig.build.json | `checks/typecheck-web.txt` |
| `npm run typecheck` | **PASS, exit 0**, shared contract + desktop | `checks/typecheck-desktop.txt` |
| `npm run lint` | **PASS, exit 0**, web ESLint src/ | `checks/lint.txt` |
| `npm run build` | **PASS, exit 0**, shared + production Next build, 181 static generation steps завершены | `checks/production-build.txt` |
| Chromium: focus/input, fullscreen enter/exit, recvonly WebRTC в обоих направлениях, WebCrypto/IndexedDB import failure/recovery | **PASS, exit 0** | `checks/browser-results.json`, `checks/browser-run.txt`, воспроизводимый harness рядом |
| YAML parse: Compose, GitHub CI, GitLab CI | **PASS**, Python PyYAML | Синтаксическая проверка, не запуск контейнеров |
| `git diff --check` | **PASS** | Проверка пробелов/конфликт-маркеров в отслеживаемом diff |
| `npm run test:types -w apps/web` | **НЕ ПРОШЁЛ: 84 ошибки в 17 файлах, exit 2** | `checks/test-fixture-types-known-debt.txt` |
| Реальная PostgreSQL / migration chain / Docker / Redis / coturn | **НЕ ЗАПУСКАЛИСЬ** | Нужен инфраструктурный staging |
| Полный Electron runtime и desktop installers на целевых ОС | **НЕ ЗАПУСКАЛИСЬ** | Проверены типы и unit/mocked IPC, не системные возможности |

## Ограничения зелёного результата

- Полный runtime-набор Vitest запущен без исключения падающих файлов и без добавления skip. 84 ошибки расширенной типизации тестов не являются runtime-падениями, но остаются открытым техническим долгом. Это ошибки моков Prisma, форм Request/NextRequest, деклараций jest-dom matchers, неполных фикстур и устаревших значений типов; среди них есть регрессионные тесты первого этапа. Production-typecheck проверен отдельно и не отключён.
- API-тесты используют моки Prisma, auth и внешних сервисов. Проверка CAS удостоверяет условие updateMany и обработку результата, но не доказывает конкурентную работу реального PostgreSQL.
- Browser harness монтирует реальные UI-компоненты и E2EE helper из исходников, однако не поднимает весь Next/Socket.IO/Prisma стек. Его WebRTC идёт по локальным ICE-кандидатам без TURN. E2EE использует реальные браузерные ключи/IDB и тестовые HTTP-ответы.
- Сборка прошла с предупреждениями: middleware convention deprecated и Turbopack NFT tracing warning для next.config.mjs / projects upload. Во время build-init недоступна тестовая SMTP-служба на localhost:25 (`SMTP verify FAILED`); exit сборки остаётся 0. Доставка писем этим прогоном не проверена.
- Исходники web/desktop и server.ts зафиксированы перед финальным прогоном; после него их контрольные суммы не изменились. `checks/SOURCE-SHA256.json` позволяет сверить проверенный код. Документация и упаковка создавались после заморозки исходников.
- Покрытие в процентах, нагрузочный тест, live migration, recovery drill и независимый security-аудит не заявляются выполненными.

## Как воспроизвести

Из корня проекта после подготовки окружения:

```sh
npm ci
npm run build:shared
npm run test -w apps/web -- --maxWorkers=2
npm run typecheck -w apps/web
npm run typecheck
npm run lint
npm run build
# Отдельный известный долг — не включён в список прошедших команд:
npm run test:types -w apps/web
```

Тесты используют `fake-indexeddb` как dev dependency; production-пакету эта библиотека не нужна. Миграции выполняются явно по ROLLOUT-RU.md, не из postinstall.

### Изолированный браузерный стенд

`checks/browser-regression.cjs` использует `esbuild`, Playwright и Chromium из тестового окружения. Playwright не добавлен в runtime-зависимости проекта: предоставьте его отдельно. Можно указать `CHROMIUM_PATH`; без него используется Chromium установленного Playwright.

```sh
CHROMIUM_PATH=/path/to/chromium node docs/review-2026-10-27/checks/browser-regression.cjs
```

Стенд создаёт временную локальную страницу, закрывает браузер и удаляет временные файлы. Результат — `checks/browser-results.json`. Никаких production-ключей/учётных данных ему не требуется.

## Перечень изменений

[CHANGED-FILES.md](./CHANGED-FILES.md) сравнивает исходники/конфигурацию с исходным архивом и включает обе серии исправлений. Основной отчёт: [TECHNICAL-UPDATE-RU.md](./TECHNICAL-UPDATE-RU.md). Инфраструктурная приёмка и rollback: [ROLLOUT-RU.md](./ROLLOUT-RU.md).
