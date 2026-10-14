# Проверки итогового TZ ID

Проверено в изолированном Linux окружении, Node 24.14.1, PostgreSQL 15, Chromium. Production-сервис требует Node >=22.12. Боевые данные и пароли пользователя не использовались. HTTP разрешался только явно для loopback тестовых сервисов.

## Результаты

| Проверка | Результат |
|---|---|
| `npm ci --ignore-scripts --dry-run --no-audit --no-fund` | lockfile согласован |
| `npm run lint` | успешно, без отключения правил React Compiler |
| `npm run build` | production-сборка успешна |
| `npm run check -w apps/id` | TypeScript check успешен |
| TZ ID web unit / API tests | 28 из 28 |
| `npm run test -w apps/id` | 8 из 8 |
| Реальный внешний OIDC flow | 18 сценариев успешны |
| Настоящий NextAuth callback + UI / API TrioZ | 11 сценариев успешны |
| Новая миграция поверх прежней схемы | существующий User.id/сеанс сохранены; Prisma diff пустой |
| Генератор ключей | файлы 600; повторный запуск отказал, прежние ключи не изменились |
| Сравнение важных старых VPN/экспорт/платежных UI файлов | байты совпадают с предыдущим архивом |

### Внешнее приложение

Discovery, S256, login + consent, точный callback, state, подпись ID token по JWKS, issuer/audience/nonce, userinfo, отсутствие дублирования User/VpnPeer, минимизация scopes, шифрование artifacts и hashing identifiers, rotation/replay refresh, replay code, неверный verifier, отсутствие PKCE, незарегистрированный redirect, CSRF, disabled client, закрытие сеанса, смена пароля, introspection active/inactive, revocation endpoint, RP-initiated logout.

### TrioZ

Настоящий browser login через TZ ID в NextAuth, прежний User.id и локальная ADMIN роль, связанный sid, интерфейс/отзыв приложения, отсутствие секретов в списке админ-клиентов, mobile 390px без горизонтального overflow, восстановление после ошибки загрузки, завершение других сеансов без потери текущего, немедленный 401 после завершения текущего, сохранение старого Credentials login, обычная смена пароля с аннулированием сеансов, вход новым паролем, обезличивание при удалении с сохранением сообщения и группы.

Визуально проверены настройки аккаунта, безопасность, подключённые приложения/пустое состояние/ошибка, админ-реестр на desktop/mobile, login и consent issuer. Скриншоты с искусственным удалённым после теста аккаунтом — в `screenshots/`. Они не содержат боевых секретов.

## Полный набор тестов — НЕ полностью зелёный

- Исходный архив отдельно, без конкурирующей сборки: **2091 passed, 21 failed**, 7 failed files.
- Итоговая версия: **2119 passed, 21 failed**, 7 failed files.
- Наборы имён падающих тестов совпадают; новых падений нет. 28 новых web tests входят в итоговый общий прогон; 8 issuer tests запускались отдельно.

Прежние проблемные файлы: desktop `vpnEmbedded.test.ts` (3), `vpnPlan.test.ts` (1), `createNotification.threadGrouping.test.ts` (1), API `dm/route.test.ts` (2), `messages/upload/route.test.ts` (13), admin `vpn/subscriptions/route.test.ts` (1). Ещё один файл — `cloudpayments/_utils.test.ts` — не инициализируется из-за существующей ошибки mocking. Они не исправлялись в задаче TZ ID.

В предварительном одновременном прогоне baseline дополнительно упал один storage-тест; повторный отдельный прогон подтвердил прежние 21. Сравнение выполнено по отдельному повторному baseline.

При сборке остались старые предупреждения Next: deprecation middleware convention и tracing `next.config.mjs` из project upload route. Сборку они не блокируют.

## Воспроизведение

Обычные проверки из корня:

```bash
npm run lint
npm run build
npm run check -w apps/id
npm run test -w apps/web -- src/lib/tzId.test.ts src/app/api/tz-id/management.test.ts
npm run test -w apps/id
npm run test -w apps/web
```

Интеграционные harness **удаляют тестовые fixtures**, поэтому они проверяют точное имя БД `/tzid_test` и loopback host. Никогда не запускать на существующей production БД. Нужны отдельный PostgreSQL, Chromium и Playwright. Если Playwright не установлен в рабочем проекте, установить его в отдельную QA папку и передать абсолютный `PLAYWRIGHT_MODULE` (как в проведённой проверке); runtime-dependency issuer ему не нужна.

```bash
# Создать ТОЛЬКО новую пустую локальную БД tzid_test штатным инструментом PostgreSQL.
export DATABASE_URL='postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/tzid_test'
# Эта команда только для пустой тестовой БД; production использует migrate deploy!
npx prisma db push --schema apps/web/prisma/schema.prisma
npm run build
export PLAYWRIGHT_MODULE=/absolute/path/to/qa/node_modules/playwright
export CHROMIUM_PATH=/absolute/path/to/chromium
# Выполнять последовательно: используются порты 3100, 3200, 3300.
npm run test:integration -w apps/id
npm run test:web:integration -w apps/id
```

Тесты сами генерируют случайные пароли/ключи и не печатают токены/секреты. Закрытые временные signing keys и диагностические файлы сохраняются вне репозитория в `/tmp/trioz-tzid-*`; не публиковать эти каталоги. Тестовый user/clients очищаются по завершении.

## Границы проверки

DNS/сертификат/боевой nginx/PM2 на сервере пользователя не менялись и не проверялись через production-доступ. Nginx templates необходимо проверить `nginx -t` на месте. Официальная OpenID conformance certification не выполнялась. System-browser SSO callback Electron/Android не реализован; штатный нативный вход сохранён. Перечисленные проверки — функциональные и регрессионные, не независимый security audit.
