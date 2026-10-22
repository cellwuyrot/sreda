# Установка исправлений админки (PM2, существующий сервер)

Архив содержит полный исходный проект. Не распаковывайте его поверх живой
папки без резервной копии. Перенесите изменения в Git, проверьте ветку и
выполняйте обновление из `/var/www/trioz`. Не переносите `node_modules`, `.next`,
чужие `.env` или секреты с другого компьютера.

Этот выпуск не добавляет миграций. Команда `migrate` ниже лишь проверяет и
применяет уже имеющиеся миграции, если сервер отставал от актуального архива.

```bash
(
  set -e
  cd /var/www/trioz
  test -x /opt/node22/bin/node
  export PATH="/opt/node22/bin:$PATH"
  unset DATABASE_URL REDIS_URL
  umask 077
  backup="/root/backups/trioz-admin-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$backup"
  git rev-parse HEAD > "$backup/commit.txt"
  git diff --binary > "$backup/local-changes.patch"
  for f in .env apps/web/.env apps/id/.env apps/id/secrets/jwks.json apps/id/secrets/env.generated; do
    if [ -f "$f" ]; then cp --parents -a "$f" "$backup/"; fi
  done
  sudo -u postgres pg_dump -Fc trioz > "$backup/trioz.dump"

  git pull --ff-only
  npm ci --ignore-scripts --no-audit --no-fund
  npm exec -w apps/web -- prisma generate
  node --env-file=apps/web/.env -e 'const u=new URL(process.env.DATABASE_URL); if(decodeURIComponent(u.pathname.slice(1))!=="trioz") throw new Error("Остановлено: проверьте базу данных в apps/web/.env"); console.log("База: trioz");'
  npm run migrate
  npm run check -w apps/id
  npm run typecheck -w apps/web
  npm run lint -w apps/web
  NODE_OPTIONS="--max-old-space-size=4096" npm run build
  pm2 restart trioz
  pm2 save
)
```

`npm ci --ignore-scripts` намеренно не запускает автоматические миграции
из `postinstall`; генерация Prisma и миграции идут отдельными явными шагами.
Не используйте глобальный `npx prisma` при отсутствии локального клиента:
он может предложить другую несовместимую версию.

Проверка после перезапуска:

```bash
curl --max-time 15 -fsS -o /dev/null -w 'TrioZ HTTP: %{http_code}\n' https://trioz.ru/
pm2 logs trioz --lines 40 --nostream
```

Затем выполнить пункты приёмки из `ADMIN-REVIEW.md`, обновив открытую вкладку
браузера. Другие процессы PM2, включая `tz-id`, для этих исправлений
перезапускать не нужно. Не запускайте `pm2 restart all`, не меняйте ключи,
не удаляйте таблицы и не выполняйте `prisma migrate reset`.

Если Git сообщает о локальных изменениях, остановитесь и сохраните их;
не заменяйте `git pull --ff-only` командой `git reset --hard`.
Если установка остановилась на тесте, типах или сборке, не перезапускайте
процесс с незавершённой сборкой. Полный набор тестов имеет 21 исходное падение,
описанное в отчёте, поэтому он не включён в автоматическую цепочку установки.
