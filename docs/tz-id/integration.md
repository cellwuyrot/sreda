# Подключение другого проекта к TZ ID

## Регистрация

В `/admin/tz-id` создать отдельный client для проекта. Указать точные HTTPS redirect URI. Confidential client — backend/BFF; secret хранится только на его сервере. Public client — SPA/мобильный клиент, secret отсутствует. HTTP callbacks допускаются исключительно на loopback при явном тестовом DEV_ALLOW_HTTP, не на production.

Приложение не должно читать таблицу User, принимать её пароль, получать NextAuth cookie или использовать NEXTAUTH_SECRET. Центральный issuer работает с существующим аккаунтом; внешний проект связывает своего пользователя по **(iss, sub)**. Username/email меняются и не являются ключом связи. Не делать автоматическую привязку чужого старого аккаунта по совпадению email без отдельного подтверждения владельца.

## Discovery и endpoints

```
issuer:        https://id.trioz.ru
discovery:     https://id.trioz.ru/.well-known/openid-configuration
authorization: https://id.trioz.ru/authorize
token:         https://id.trioz.ru/token
userinfo:      https://id.trioz.ru/userinfo
JWKS:          https://id.trioz.ru/jwks
revocation:    https://id.trioz.ru/revoke
introspection: https://id.trioz.ru/introspect
```

Logout URL брать из `end_session_endpoint` discovery. Использовать поддерживаемую OIDC client-библиотеку: **не писать свою проверку JWT или OAuth state**. Discovery/JWKS кешировать с поддержкой обновления key/kid; проверять точный HTTPS issuer.

## Полный вход

1. На старте входа создать криптографически случайные state, nonce и code_verifier (32+ байта, base64url). Хранить в защищённой временной сессии клиента, не в общем localStorage проекта. `code_challenge = base64url(SHA256(code_verifier))`.
2. Отправить браузер на authorization endpoint:

```
response_type=code
client_id=<registered client>
redirect_uri=<exact registered callback>
scope=openid profile email
state=<random per attempt>
nonce=<random per attempt>
code_challenge=<S256 challenge>
code_challenge_method=S256
```

3. Обработать отказ (`error=access_denied`) без создания аккаунта. В успешном callback одноразово проверить state и привязку к исходной браузерной сессии. Не принимать callback, который клиент сам не начинал.
4. Обменять code на token endpoint, `application/x-www-form-urlencoded`:

```
grant_type=authorization_code
code=<received code>
redirect_uri=<same exact URI>
code_verifier=<original verifier>
```

Confidential client аутентифицируется **client_secret_basic**; public client передаёт client_id и не выдумывает client secret. Все клиенты обязаны использовать PKCE. Не помещать секрет в frontend bundle, URL или CI лог.

5. OIDC-библиотека должна проверить ID token: подпись разрешённым RS256 ключом JWKS, issuer, audience/client_id, exp/iat, nonce и необходимые условия azp. Просто декодировать JWT недостаточно. На найденный `(iss,sub)` привязать локальную запись; роли внешнего проекта назначает сам проект.
6. Userinfo вызывать с `Authorization: Bearer <access_token>`, **не с id_token**. Проверить, что userinfo.sub совпадает с проверенным ID token.sub.
7. Создать собственную защищённую cookie-сессию проекта, хранить tokens на backend/в безопасном хранилище платформы. Не писать tokens в console/analytics/access логи и не пересылать в чат.

## Scopes / claims

| Scope | Данные |
|---|---|
| openid | sub — существующий постоянный User.id |
| profile | name, preferred_username, picture (когда аватар есть) |
| email | email, email_verified |
| offline_access | refresh token, только если разрешён client и пользователь дал consent |

Запрашивать минимум. Без `email` адрес не выдаётся, без `profile` не выдаются имя/username/аватар. Проверять `email_verified`, если он нужен бизнес-политике; не считать наличие адреса его подтверждением. `privacyEmail` социальных страниц не превращает email в публичный API: передача здесь зависит от явного scope/consent.

`offline_access` запрашивать с `prompt=consent`. Refresh tokens вращаются: сохранять новый после каждого обмена, старый удалять; параллельные refresh координировать. Повторное использование старого token может отозвать весь grant. При invalid_grant очистить локальные tokens и предложить новый вход. Не обещать 30 дней безусловного доступа: token привязан к активному сеансу TZ ID.

## Отзыв / локальный выход

Revocation: POST token endpoint-authenticated запрос `token=<access or refresh token>` на `/revoke`. Интроспекция: POST `token=...` на `/introspect` с аутентификацией зарегистрированного клиента по его методу. Для server-to-server проверки применять confidential client, а не открывать его secret браузеру.

Пользователь также может отозвать приложение в настройках TrioZ или завершить связанный сеанс. Тогда tokens/userinfo/introspection перестают давать доступ независимо от срока opaque token. У приложения может остаться своя cookie-сессия: оно должно проверять активность/применять срок и корректно завершать собственный доступ. Сам по себе ранее валидный ID token не подтверждает текущую активность доступа навсегда.

Для полного выхода из issuer открыть end_session_endpoint с актуальным `id_token_hint`, подтвердить выход. Post-logout redirect URI в этом базовом реестре не настраивается: завершение ведёт на страницу issuer. Выход не гарантирует удаления всех уже сохранённых сторонним проектом данных.

## Реальный проверяемый пример

`apps/id/test/integration.ts` поднимает отдельный HTTP callback внешнего приложения на loopback, проходит login+consent настоящим браузером, выполняет code/token/userinfo/JWKS/refresh/revoke/logout проверки. `web-integration.ts` отдельно проверяет настоящий NextAuth callback TrioZ и UI управления. Это тестовые harness, не шаблон production BFF и не публичные клиенты с боевыми реквизитами.
