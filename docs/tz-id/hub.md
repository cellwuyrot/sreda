# TZ ID: кабинет, QR и API проектов

## Реализовано

- Кабинет на корне id.trioz.ru: логотип TrioZ, имя, ник, постоянный ID, профиль; адреса, подписки, подключённые проекты, уведомления, безопасность, сотрудничество.
- /tz-id в TrioZ: тот же профиль/контакт, подписки, права проектов и уведомления. Ссылка из настроек TZ ID.
- Один User. Регистрация существующим /api/auth/register создаёт аккаунт сразу для TrioZ и TZ ID. Копирования пользователя и новой VPN-личности нет.
- Редактирование имени/ника использует общий identityPatch и прежние ограничения Premium/14 дней. Аватар/email редактируются существующим интерфейсом TrioZ; issuer и userinfo читают ту же запись.
- contactAddress: необязательный свободный контактный адрес до 500 символов, может быть удалён. Никакой передачи без contact:read.
- Premium/VPN показываются по существующим правилам. Иностранная подписка хранится отдельно, не меняет isPremium, vpnAccess, платёжную историю или лимиты VPN.
- Последние 100 уведомлений объединяют существующий пользовательский список TrioZ и поступления проектов. Фильтр по источнику, отметка прочтения. У внешнего проекта можно отдельно выключить поступление уведомлений или отозвать доступ.
- Сотрудничество ведёт из issuer на /tz-id?section=cooperation и использует существующий CooperationButton, /api/appeals и бизнес-чат. Нового типа заявки нет. При отсутствии cookie TrioZ пользователь входит обычным способом или через настроенный TZ ID SSO.
- 2FA: честный статус «пока недоступна», не включена. TOTP/passkeys/SMS-коды этим релизом НЕ реализуются.

## QR-вход

На /login кабинета или на странице OIDC interaction подключённого приложения нажать «Показать QR-код». На телефоне открыть его камерой, войти в TZ ID (если нужно), сверить проект, домен и шестизначный код; явно подтвердить вход. Для приложения далее сохраняются consent, Authorization Code, state/nonce и PKCE S256.

QR действует 120 секунд. В QR URL одноразовый случайный секрет подтверждения в fragment, не пароль/сессия/access token. На сервере только SHA256-хеши QR-секретов. Код связан с исходной interaction и browser proof в HttpOnly cookie. Сканирование само по себе НЕ авторизует. Подтверждение и потребление атомарны; повтор, другой браузер, истёкший QR, отключённый проект или отозванный телефонный сеанс не дают вход. При входе в кабинет создаётся новый отдельный UserSession, а не копия cookie телефона.

Телефон должен иметь сеанс именно id.trioz.ru; cookie TrioZ не передаётся между доменами. Fragment очищается из адресной строки, временный код сохраняется в sessionStorage до подтверждения/возврата после входа. При запрещённом хранилище после входа повторно открыть QR. Не сканировать чужие предложения «подтвердить вход».

## Подключение любого проекта, включая проекты экосистемы

1. Создать client в /admin/tz-id, указать точные HTTPS callback. Для серверной интеграции confidential client; secret только на backend.
2. Выбрать разрешённые дополнительные права API. Пользователь отдельно подтверждает запрошенные scopes.
3. Использовать стандартную OIDC-библиотеку и discovery. Проект связывает локальную запись по (issuer, sub), не по email. Существующие записи не связывать без подтверждения владельца.
4. Все новые регистрации направлять в существующую регистрацию TrioZ/TZ ID. Не создавать второй пароль пользователя и не копировать центральную таблицу User. Локальная запись проекта при успешном OIDC-входе — это связь с TZ ID, не отдельный центральный аккаунт.
5. После проверенного входа использовать access token для /userinfo и расширенного API. Не ID token, не чужую cookie и не прямой доступ к БД. Для записи внешних данных обязателен confidential client и делегированный user access token.
6. Если требуется фоновая публикация, запросить offline_access с consent и корректно вращать refresh token. Отзыв/выход прекращает доступ. Это НЕ неограниченный machine-to-machine доступ ко всем пользователям.

Проекты ecosystem НЕ подключаются автоматически по домену. Для каждого нужна регистрация клиента и реализация callback/backend API в его коде. Исходники этих проектов в данном архиве не предоставлены; готова центральная сторона и backend-пример examples/project-api.ts. Способ входа (пароль/QR) выбирается на issuer; менять OAuth-протокол в каждом клиенте не нужно.

## Endpoints (Authorization: Bearer <access_token>)

| Метод/адрес | Scope | Назначение |
|---|---|---|
| GET /userinfo | openid + profile/email | Общие данные согласно consent |
| GET /api/v1/contact | contact:read | { sub, contactAddress } |
| GET /api/v1/subscriptions | subscriptions:read | { sub, subscriptions } без платёжных реквизитов |
| PUT /api/v1/subscriptions | subscriptions:write | Обновить собственную внешнюю подписку |
| POST /api/v1/notifications | notifications:write | Уведомление собственного проекта |

Расширенное API предназначено для backend/BFF или нативного клиента. Cookie-авторизация не принимается. Browser CORS к этим маршрутам не открыт: SPA вызывает собственный BFF. Базовый /userinfo сохраняет стандартную политику OIDC.

PUT subscription body:
```json
{"externalId":"order-123","title":"Подписка сервиса","status":"active","expiresAt":"2027-01-01T00:00:00Z"}
```
expiresAt может быть null; status — active/canceled/expired. Повтор того же (client, user, externalId) обновляет одну запись. Это информационная запись источника, не доказательство оплаты или право на функции других проектов.

POST notification body:
```json
{"externalId":"event-123","title":"Обновление заявки","body":"Ваша заявка рассмотрена","url":"https://your-project.example/account"}
```
url необязателен и разрешён только на origin зарегистрированного callback проекта, без userinfo/небезопасных схем. Повтор externalId не создаёт дубль и не сбрасывает прочтение. При отключённых пользователем уведомлениях: {accepted:false,reason:"notifications_disabled"}. Лимиты: 120 API-запросов/мин на client+user, 30 новых уведомлений/час на client+user. DB-namespace берётся только из токена; userId/clientId/sub в body запрещены.

Ошибки: 401 — отсутствует/отозван/истёк токен; 403 — нет consent/права клиента; 400 — неверные поля; 429 — лимит. Не хранить токены в frontend, не журналировать Authorization, code/secret и QR fragments.

## Обновление работающего сервера

Сохранить резервную копию БД trioz, .env, apps/id/secrets и загрузок. Не перегенерировать ключи и не копировать примеры поверх рабочих env. Код обновить без удаления этих данных.

Новая миграция: 20261015000000_tz_id_hub. В DATABASE_URL должна быть trioz. Установка без postinstall, затем явная миграция и сборка:
```bash
cd /var/www/trioz
unset DATABASE_URL REDIS_URL
PATH="/opt/node22/bin:$PATH" npm ci --ignore-scripts
PATH="/opt/node22/bin:$PATH" npm run migrate
PATH="/opt/node22/bin:$PATH" npm run build
PATH="/opt/node22/bin:$PATH" npm run check -w apps/id
```
Выполнять последовательно и остановиться при ошибке. Это выбирает Node 22 только для команды, не меняет interpreter остальных PM2-процессов. Никакого pm2 update/restart all. Миграция проверена на прежней схеме в отдельной БД, а не на сервере пользователя.

После успешной сборки перезапустить только trioz и tz-id. При сохранённом в PM2 старом окружении явно подставить значения из соответствующих файлов, не выводя их:
```bash
cd /var/www/trioz
/opt/node22/bin/node <<'NODE'
const fs = require("node:fs");
const dotenv = require("dotenv");
const { spawnSync } = require("node:child_process");
for (const [name, file] of [["trioz", "apps/web/.env"], ["tz-id", "apps/id/.env"]]) {
  const config = dotenv.parse(fs.readFileSync(file));
  if (decodeURIComponent(new URL(config.DATABASE_URL).pathname.slice(1)) !== "trioz") throw new Error("Неверная база; перезапуск остановлен");
  const result = spawnSync("pm2", ["restart", name, "--update-env"], { stdio: "inherit", env: { ...process.env, ...config, NODE_ENV: "production" } });
  if (result.status !== 0) process.exit(1);
}
NODE
```
Проверить /health, discovery, реальный парольный/QR-вход, кабинет и consent; затем pm2 save. /health — только liveness. Nginx/DNS/TLS менять не требуется, используется уже работающий id virtual host. Существующие opaque tokens без новых scopes остаются базовыми: дополнительные права нужно запросить новым consent; старому client без этих прав нужен отдельный новый client/переход по согласованной схеме, не правка БД вручную.
