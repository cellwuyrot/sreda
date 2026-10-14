# Развёртывание TZ ID на id.trioz.ru — без Docker

## 0. Перед обновлением

1. Сделать резервную копию PostgreSQL и текущего проекта штатным способом; сохранить текущие `.env`, `public/uploads` / отдельное файловое хранилище и PM2-конфигурацию. Не заменять файлы окружения примерами из архива.
2. Проверить, что DNS id.trioz.ru смотрит на этот сервер, порты 80/443 доступны, а другой virtual host этого имени не существует.
3. Подготовить **отдельный Node >=22.12** (например актуальный Node 22 LTS) для `apps/id`. Текущий Node 20.20.2 существующего TrioZ можно оставить. Не запускать `pm2 update`, `pm2 restart all`, не менять interactive/nastolka.
4. Файлы `deploy/nginx-*` — примеры для nginx. Ни существующий основной virtual host, ни настройки VPN они не заменяют.

Ниже пример `/var/www/trioz` и отдельного Node в `/opt/node22/bin/node`. Если он установлен иначе — указать реальный абсолютный путь. Архив распаковывать сначала во временную папку, затем обновлять код, сохраняя рабочее окружение/загрузки.

```bash
cd /var/www/trioz
export TZ_ID_NODE=/opt/node22/bin/node
"$TZ_ID_NODE" --version
# Далее выполнять npm под этим Node, не переключая PM2 daemon / остальные приложения.
export PATH="$(dirname "$TZ_ID_NODE"):$PATH"
npm ci --ignore-scripts
npm run migrate -w apps/web
npm run build
npm run check -w apps/id
```

`npm run migrate` читает реальный `apps/web/.env` и применяет pending миграции, в том числе предыдущую миграцию цитат чата, если она ещё не применена. При ошибке миграции/сборки остановиться, не перезапускать рабочий процесс. Исторические миграции целиком на production БД здесь не прогонялись: новая TZ ID миграция проверена отдельно от актуальной прежней схемы.

## 1. Постоянные ключи и конфигурация

```bash
cd /var/www/trioz
npm run keys -w apps/id
cp apps/id/.env.example apps/id/.env
chmod 600 apps/id/.env
```

Ключи создаются **один раз** в `apps/id/secrets/` (файлы 600, папка 700):
- `jwks.json` — приватный ключ подписи. Публичные ключи выдаёт `/jwks`.
- `env.generated` — значения storage/cookie keys; их нужно приватно перенести в `apps/id/.env`.

Заполнить `apps/id/.env`:
- `DATABASE_URL`: **та же БД**, что у apps/web.
- `REDIS_URL`: тот же Redis, включая пароль, если используется; это общий лимит попыток входа.
- `TZ_ID_ISSUER=https://id.trioz.ru`, `TZ_ID_WEB_ORIGIN=https://trioz.ru`.
- `TZ_ID_JWKS_FILE`, `TZ_ID_STORAGE_KEY`, `TZ_ID_COOKIE_KEYS` из generated файла.
- `TZ_ID_DEV_ALLOW_HTTP=0` на production.

В рабочий `apps/web/.env` добавить **тот же** `TZ_ID_STORAGE_KEY` (админ-реестр шифрует client metadata этим ключом). NextAuth secret не копировать в сторонние приложения или issuer.

Не выводить ключи в CI / PM2 логи, не коммитить `.env`/secrets, не помещать их в публичные резервные архивы. Генератор не перезаписывает существующие ключи. Смена storage key без перешифрования данных сделает сохранённые artifacts/клиентов нечитаемыми. Для ротации RSA добавлять новый key/kid и сохранять старые публичные ключи на период жизни выданных токенов, а не просто удалять старый файл. Резервировать ключи вместе с БД отдельно и зашифрованно.

## 2. HTTPS (пример Debian/Ubuntu nginx sites-enabled)

Если сертификат уже есть, перейти к установке финального virtual host. Если используются `conf.d`, адаптировать пути и **не подключать один host дважды**.

```bash
mkdir -p /var/www/letsencrypt
cp /var/www/trioz/deploy/nginx-id.bootstrap.conf /etc/nginx/sites-available/id.trioz.ru
ln -s /etc/nginx/sites-available/id.trioz.ru /etc/nginx/sites-enabled/id.trioz.ru
nginx -t && systemctl reload nginx
certbot certonly --webroot -w /var/www/letsencrypt -d id.trioz.ru
# Только после успешного выпуска сертификата:
cp /var/www/trioz/deploy/nginx-id.trioz.ru.conf /etc/nginx/sites-available/id.trioz.ru
nginx -t && systemctl reload nginx
```

Certbot должен быть установлен; renewal timer должен работать. При существующей symlink не создавать вторую. Bootstrap host до выпуска сертификата отвечает 503 вне ACME path — это ожидаемо.

Финальный host проксирует только на loopback:3100, перезаписывает X-Real-IP/X-Forwarded-For/Proto, выдаёт Secure cookie через HTTPS. Не открывать 3100 в интернет. Если впереди CDN/другой proxy — согласовать доверенные hops/real-ip и редактирование query-string логов отдельно. На issuer access_log выключен, чтобы authorization codes не попадали в access логи. Для callback TrioZ и сторонних клиентов тоже не журналировать код, state, токены и секреты.

## 3. Запуск отдельного процесса PM2

```bash
cd /var/www/trioz
export TZ_ID_NODE=/opt/node22/bin/node
pm2 start ecosystem.id.config.cjs --only tz-id
pm2 describe tz-id
curl -fsS http://127.0.0.1:3100/health
curl -fsS https://id.trioz.ru/.well-known/openid-configuration
# После проверки и успешной сборки нового web-кода:
pm2 restart trioz --update-env
pm2 save
```

Issuer в discovery должен быть **https://id.trioz.ru**, не localhost. `/health` — liveness, не проверка всех зависимостей. Проверить реальные вход/consent/callback, админ-реестр и отзыв доступа через HTTPS. Диагностика: `pm2 logs tz-id --lines 30 --nostream` (не включать debug вывод token payload).

PM2-конфигурация требует абсолютный `TZ_ID_NODE`. Не копировать секреты в ecosystem файл; dotenv читает закрытый `apps/id/.env`. При обновлениях сохранять `.env`/secrets и использовать `pm2 restart tz-id`, а не создавать второй процесс с тем же именем.

## 4. Дополнительная кнопка входа TZ ID в TrioZ

Необязательная настройка: пока client ID/secret пусты, обычный вход продолжает работать. Зарегистрировать confidential клиент с точным callback:
`https://trioz.ru/api/auth/callback/tz-id`.

Можно через `/admin/tz-id` после обычного входа либо CLI:

```bash
cd /var/www/trioz
npm run client -w apps/id -- "TrioZ" https://trioz.ru/api/auth/callback/tz-id /root/tzid-trioz-client.json
```

CLI читает `apps/id/.env`; secret не печатается, сохраняется в новый файл 600. В `apps/web/.env` приватно добавить `TZ_ID_ISSUER=https://id.trioz.ru`, `TZ_ID_CLIENT_ID` и `TZ_ID_CLIENT_SECRET` из созданных реквизитов. Затем перезапустить **только trioz** с обновлённым окружением. Не менять NEXTAUTH_URL/SECRET на issuer: web cookie остаётся своим.

Проверить кнопку в обычном браузере; текущие нативные клиенты сохраняют прежний вход.

## 5. Отказ и откат

Если issuer недоступен, обычный Credentials вход TrioZ остаётся. Если новые таблицы/ключи не настроены, TZ ID функции нельзя считать запущенными. При откате сначала сохранить БД и ключи, отключить новые clients/отозвать доступ и убрать optional web SSO env. Вернуть предыдущий web-архив и перезапустить только соответствующие процессы. Добавленные таблицы/nullable колонку можно оставить: они совместимы со старым кодом; не удалять их без резервной копии и осознанной миграции.

Старый web-код не обеспечивает новую sid-проверку отзыва JWT: откат также откатывает эту защиту.
