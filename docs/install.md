# Установка и эксплуатация

Всё, что нужно, чтобы поднять TrioZ с нуля и поддерживать: пустой сервер, Docker, обновление, переменные окружения.

### Релизы десктопа (self-hosted, без GitHub)

Установщики десктопа раздаются **с самого сайта**, а не с GitHub. Кнопка
«Скачать десктоп-версию» на `/about` ведёт на веб-роут
`GET /api/download/desktop?os=…`, который **стримит установщик напрямую**
(`Content-Disposition: attachment`) из локального хранилища
`apps/web/public/desktop`. Никакого перехода на `github.com` и промежуточных
редиректов — загрузка начинается сразу.

Это же хранилище отдаётся статикой по пути `/desktop/` (с поддержкой Range),
поэтому оттуда же работают автообновление Electron и онлайн-установщик
`nsis-web` — адрес совпадает с `publish.url` / `nsisWeb.appPackageUrl` в
`apps/desktop/electron-builder.yml` (`https://connect.trioz.ru/desktop/`).

Как опубликовать сборку с автообновлением (одной командой):

```bash
npm run desktop:release          # pm2/git: авто-версия + сборка + публикация в apps/web/public/desktop
npm run desktop:release:docker   # Docker/прод: то же, но публикация в том desktop_data
```

`desktop:release` вычисляет версию `0.<minor>.<число коммитов>`
(`scripts/desktop-version.mjs`), поэтому **каждое обновление проекта строго
новее** предыдущего — это единственное, что проверяет `electron-updater` перед
установкой обновления. Обычный `npm run desktop:dist` берёт замороженную версию
из `package.json` и для автообновления **не годится**.

Отдельные шаги, если нужно:

```bash
npm run desktop:dist:auto        # собрать установщики текущей ОС с авто-версией
npm run desktop:publish -- --clean  # локально: скопировать apps/desktop/release/* в чек-аут (с очисткой)
npm run desktop:publish:docker   # Docker/прод: скопировать их прямо в том desktop_data
```

Собирать установщики нужно на соответствующей ОС (Windows → `.exe`,
macOS → `.dmg`, Linux → `.AppImage`/`.deb`) — например, через GitHub Action
`Build desktop installers`, затем положить артефакты в
`apps/web/public/desktop`. Подробности — в
[`apps/web/public/desktop/README.md`](apps/web/public/desktop/README.md).
Путь к хранилищу можно переопределить переменной `DESKTOP_DOWNLOAD_DIR`; в
Docker это постоянный том `desktop_data`, смонтированный в
`/app/apps/web/public/desktop`.

> ⚠️ В Docker путь `apps/web/public/desktop` **внутри контейнера** — это том
> `desktop_data`, то есть другое место, чем `apps/web/public/desktop` в чек-ауте
> репозитория на хосте. Поэтому `npm run desktop:publish` (пишет в чек-аут)
> **не попадает** в том, из которого раздаёт контейнер. Используйте
> `npm run desktop:publish:docker` — он запускает одноразовый сервис
> `desktop-publish` (`docker compose --profile publish run --rm desktop-publish`),
> монтирует тот же том `desktop_data` и кладёт установщики прямо туда (заодно
> очищая предыдущую сборку). Деплой в GitLab CI делает этот шаг автоматически
> после `docker-compose up -d app`, если в `apps/desktop/release/` есть свежие
> установщики. Роут раздачи — `force-dynamic`, поэтому файлы видны сразу, без
> перезапуска приложения.

---

## Установка на пустой сервер (Ubuntu/Debian)

> Все команды выполняются от root. Порт по умолчанию — **3005** (можно изменить).

### 1. Подготовка системы

```bash
apt update && apt upgrade -y
apt install -y curl git build-essential
```

### 2. Установка Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v && npm -v
```

### 3. Установка PostgreSQL

```bash
apt install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql

sudo -u postgres psql -c "CREATE USER trioz WITH PASSWORD 'trioz_secret';"
sudo -u postgres psql -c "CREATE DATABASE trioz OWNER trioz;"
```

### 4. Установка Redis (опционально)

```bash
apt install -y redis-server
systemctl start redis-server
systemctl enable redis-server
redis-cli ping
```

> Без Redis проект работает с in-memory fallback для rate limiting.

### 5. Клонирование и установка

```bash
cd /root
git clone https://github.com/acoulbot/trioztest.git
cd trioztest
npm install
```

### 6. Настройка .env

```bash
cat > .env << 'EOF'
# ─── Database ────────────────────────────────────────────────────────
DATABASE_URL="postgresql://trioz:trioz_secret@localhost:5432/trioz"

# ─── Redis ───────────────────────────────────────────────────────────
REDIS_URL="redis://localhost:6379"

# ─── NextAuth ────────────────────────────────────────────────────────
NEXTAUTH_URL="http://YOUR_SERVER_IP:3005"
NEXTAUTH_SECRET="СГЕНЕРИРУЙТЕ_КОМАНДОЙ_НИЖЕ"

# ─── Security ────────────────────────────────────────────────────────
ENCRYPTION_SECRET="СГЕНЕРИРУЙТЕ_КОМАНДОЙ_НИЖЕ"
ALLOWED_ORIGINS="http://YOUR_SERVER_IP:3005"

# ─── Port ────────────────────────────────────────────────────────────
PORT=3005

# ─── TURN Server (голосовые каналы, опционально) ─────────────────────
TURN_URL=""
TURN_USERNAME=""
TURN_CREDENTIAL=""

# ─── Почта: сервис отправки (github.com/acoulbot/smtp) ───────────────
SMTP_SERVICE_URL=""
SMTP_SERVICE_KEY=""
SMTP_FROM=""

# ─── Почта: прямой SMTP, если сервис не задан ────────────────────────
SMTP_HOST=""
SMTP_PORT=587
SMTP_USER=""
SMTP_PASSWORD=""
EOF
```

**Сгенерировать секреты:**

```bash
NEXTAUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_SECRET=$(openssl rand -base64 32)
sed -i "s|NEXTAUTH_SECRET=\"СГЕНЕРИРУЙТЕ_КОМАНДОЙ_НИЖЕ\"|NEXTAUTH_SECRET=\"$NEXTAUTH_SECRET\"|" .env
sed -i "s|ENCRYPTION_SECRET=\"СГЕНЕРИРУЙТЕ_КОМАНДОЙ_НИЖЕ\"|ENCRYPTION_SECRET=\"$ENCRYPTION_SECRET\"|" .env
```

**Заменить IP сервера:**

```bash
SERVER_IP=$(curl -s ifconfig.me)
sed -i "s|YOUR_SERVER_IP|$SERVER_IP|g" .env
```

**Проверить .env:**

```bash
cat .env
```

### 7. Миграции и seed

```bash
npm run migrate   # prisma migrate deploy для apps/web
npm run seed
```

### 8. Сборка

```bash
npm run build     # собирает packages/shared, затем apps/web (next build)
```

### 9. Запуск (PM2 — рекомендуется)

```bash
npm install -g pm2

pm2 start npm --name "trioz" -- start
pm2 save
pm2 startup
```

**Проверить:**

```bash
pm2 status
curl http://localhost:3005
```

**Полезные команды PM2:**

```bash
pm2 logs trioz          # Логи
pm2 restart trioz       # Перезапуск
pm2 stop trioz          # Остановить
pm2 delete trioz        # Удалить из PM2
```

### 10. Настройка Nginx (проксирование домена)

```bash
apt install -y nginx
```

```bash
cat > /etc/nginx/sites-available/trioz << 'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN;

    client_max_body_size 30M;   # запас над лимитом приложения (25 МБ на документ)

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
EOF
```

```bash
ln -sf /etc/nginx/sites-available/trioz /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

**SSL (Let's Encrypt):**

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d YOUR_DOMAIN
```

После SSL обновите `.env`:

```bash
sed -i "s|http://|https://|g" .env
pm2 restart trioz
```

---

## Установка через Docker (альтернатива)

### 1. Установка Docker

```bash
apt update
apt install -y curl
curl -fsSL https://get.docker.com | sh
systemctl start docker
systemctl enable docker
```

### 2. Установка Docker Compose

```bash
apt install -y docker-compose-plugin
docker compose version
```

### 3. Клонирование

```bash
cd /root
git clone https://github.com/acoulbot/trioztest.git
cd trioztest
```

### 4. Настройка .env

```bash
cat > .env << 'EOF'
# ─── Docker Compose ─────────────────────────────────────────────────
POSTGRES_USER=trioz
POSTGRES_PASSWORD=trioz_secret
POSTGRES_DB=trioz

# ─── App ─────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://trioz:trioz_secret@postgres:5432/trioz"
REDIS_URL="redis://redis:6379"
NEXTAUTH_URL="http://YOUR_SERVER_IP:3005"
NEXTAUTH_SECRET="СГЕНЕРИРУЙТЕ_КОМАНДОЙ_НИЖЕ"
ENCRYPTION_SECRET="СГЕНЕРИРУЙТЕ_КОМАНДОЙ_НИЖЕ"
ALLOWED_ORIGINS="http://YOUR_SERVER_IP:3005"
PORT=3005
EOF
```

```bash
NEXTAUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_SECRET=$(openssl rand -base64 32)
sed -i "s|NEXTAUTH_SECRET=\"СГЕНЕРИРУЙТЕ_КОМАНДОЙ_НИЖЕ\"|NEXTAUTH_SECRET=\"$NEXTAUTH_SECRET\"|" .env
sed -i "s|ENCRYPTION_SECRET=\"СГЕНЕРИРУЙТЕ_КОМАНДОЙ_НИЖЕ\"|ENCRYPTION_SECRET=\"$ENCRYPTION_SECRET\"|" .env
SERVER_IP=$(curl -s ifconfig.me)
sed -i "s|YOUR_SERVER_IP|$SERVER_IP|g" .env
```

### 5. Изменить порт в docker-compose.yml

```bash
sed -i 's/"3000:3000"/"3005:3005"/' docker-compose.yml
```

### 6. Запуск

```bash
docker compose up -d
```

**Дождаться запуска PostgreSQL и применить миграции:**

```bash
sleep 10
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run seed
```

**Проверить:**

```bash
docker compose ps
curl http://localhost:3005
```

**Полезные команды Docker:**

```bash
docker compose logs -f app      # Логи приложения
docker compose restart app      # Перезапуск
docker compose down             # Остановить всё
docker compose up -d --build    # Пересобрать и запустить
```

---

## Остановка и удаление проекта

### PM2

```bash
pm2 stop trioz
pm2 delete trioz
rm -rf /root/trioztest
```

### Docker

```bash
cd /root/trioztest
docker compose down -v    # -v удалит и данные БД
rm -rf /root/trioztest
```

### Убить процесс на порту (если запущен без PM2/Docker)

```bash
kill -9 $(lsof -t -i:3005) 2>/dev/null
```

---

## Обновление

### PM2

```bash
cd /root/trioztest
git pull
npm install
npm run migrate
npm run build
pm2 restart trioz
```

### Docker

```bash
cd /root/trioztest
git pull
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
```

---

## Переменные окружения

| Переменная | Описание | Обязательна |
|-----------|----------|:-----------:|
| `DATABASE_URL` | PostgreSQL connection string | да |
| `NEXTAUTH_SECRET` | Секрет для JWT | да |
| `NEXTAUTH_URL` | URL приложения | да |
| `ENCRYPTION_SECRET` | Ключ шифрования конфигов | да |
| `PORT` | Порт сервера (по умолчанию 3000) | нет |
| `REDIS_URL` | Redis URL | нет |
| `ALLOWED_ORIGINS` | CORS origins | нет |
| `TURN_URL` | TURN-сервер для WebRTC | нет |
| `TURN_USERNAME` | TURN логин | нет |
| `TURN_CREDENTIAL` | TURN пароль | нет |
| `SMTP_SERVICE_URL` | Адрес почтового сервиса (основной путь отправки) | нет |
| `SMTP_SERVICE_KEY` | Ключ сайта в почтовом сервисе (`sm_…`) | нет |
| `SMTP_HOST` | SMTP сервер | нет |
| `SMTP_PORT` | SMTP порт | нет |
| `SMTP_SECURE` | Явный режим TLS; по умолчанию выводится из порта (465 — да) | нет |
| `SMTP_USER` | SMTP логин | нет |
| `SMTP_PASSWORD` | SMTP пароль | нет |
| `SMTP_FROM` | Адрес отправителя | нет |

Письма отправляются через почтовый сервис `github.com/acoulbot/smtp`
(`SMTP_SERVICE_URL` + `SMTP_SERVICE_KEY`): у него relay-провайдеры с
переключением при отказе, DKIM и журнал отправок. Прямой SMTP (`SMTP_HOST`)
остаётся запасным путём и используется, только если сервис не задан.
Подробнее — [`docs/explainers/email-smtp.md`](docs/explainers/email-smtp.md).

## Демо-доступ

| Роль | Email | Пароль |
|------|-------|--------|
| Админ | admin@trioz.ru | admin123 |
| Пользователь | user@trioz.ru | user123 |
