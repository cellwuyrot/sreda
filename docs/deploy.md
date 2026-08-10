# Деплой trioz на сервер

Репозиторий — монорепозиторий (npm workspaces). Веб-приложение живёт в
`apps/web`, его загрузки — в `apps/web/public/uploads/`.

## Безопасная команда деплоя (не удаляет загруженные файлы)

```bash
cd /var/www/trioz
git fetch origin
git reset --hard origin/main
# НЕ используй git clean -fd — это удалит apps/web/public/uploads/
# (аватарки, иконки, файлы чата)
npm install
npm run migrate      # = prisma migrate deploy для apps/web
npm run build        # собирает packages/shared, затем apps/web
pm2 restart trioz
```

## Почему нельзя git clean -fd

Папка `apps/web/public/uploads/` не хранится в git (содержимое в .gitignore),
но именно туда сохраняются все пользовательские файлы:

- `apps/web/public/uploads/avatars/`   — аватарки пользователей
- `apps/web/public/uploads/groups/`    — иконки групп
- `apps/web/public/uploads/messages/`  — вложения в сообщениях (фото, файлы, голосовые)
- `apps/web/public/uploads/banners/`   — баннеры профилей

`git clean -fd` удаляет все неотслеживаемые файлы → все изображения пропадают.

## Если файлы уже удалены

Пользователям нужно заново загрузить аватарки.
Ничего автоматически восстановить нельзя — бэкапа нет.

## Первичная настройка папок (один раз)

```bash
mkdir -p /var/www/trioz/apps/web/public/uploads/{avatars,groups,messages,banners}
```

## Публикация десктоп-установщиков (с автообновлением)

Клиент обновляется через `electron-updater`: он опрашивает фид
`https://connect.trioz.ru/desktop/latest.yml` и ставит новую версию **только
если она строго больше** установленной. Поэтому «обновить проект» = собрать
установщик с **большей версией** и положить его (вместе с `latest*.yml`) туда,
откуда сайт раздаёт `/desktop/`.

### Одна команда после `git pull`

```bash
cd /var/www/trioz
npm run desktop:release
```

`desktop:release` делает всё сразу:

1. вычисляет версию `0.1.<число коммитов>` (`scripts/desktop-version.mjs`) — она
   растёт с каждым новым коммитом, так что **каждое обновление проекта строго
   новее** предыдущего, вручную ничего бампать не нужно;
2. собирает установщик текущей ОС с этой версией (чистит `release/` перед
   сборкой, чтобы не осталось старого установщика);
3. публикует его с очисткой старого в хранилище `apps/web/public/desktop/`
   (`npm run desktop:publish -- --clean`).

Маршрут раздачи `force-dynamic`, поэтому свежие файлы видны на следующем запросе
— **перезапуск `pm2` для установщиков не нужен**. Установленные клиенты увидят
новую версию при ближайшей проверке (сразу при запуске и далее раз в 6 часов) и
предложат перезапуститься — без переустановки.

> Подстраховка: `apps/desktop/release/` теперь тоже входит в список раздачи (с
> самым низким приоритетом). Так что даже голый `npm run desktop:dist:auto` без
> шага публикации уже отдаётся кнопкой на `/about` и фидом обновлений. Порядок
> поиска — в [`apps/web/public/desktop/README.md`](apps/web/public/desktop/README.md).

### Важные нюансы про платформы

- **Собирается только установщик той ОС, где запущена сборка.** На Linux-сервере
  `desktop:release` даст `.AppImage`/`.deb` (Windows-`.exe` — только через
  `wine`, см. образ `electronuserland/builder:wine`). Автообновятся те
  платформы, которые ты реально пересобираешь.
- **macOS (`.dmg`) нельзя собрать/подписать на Linux**, а автообновление на
  macOS требует подписи кода. Собирайте `.dmg` на macOS или через GitHub Actions
  (`Build desktop installers`) и публикуйте так же (`npm run desktop:publish`).
- Чтобы перескочить minor/major (напр. `0.1.x` → `0.2.0`), поднимите minor в
  `apps/desktop/package.json`; patch всё так же выведется из числа коммитов.

### Docker/compose-деплой

Там `apps/web/public/desktop` внутри контейнера — это том `desktop_data`,
поэтому публикуйте `npm run desktop:release:docker` (сборка с авто-версией +
`docker compose --profile publish run --rm desktop-publish`). Деплой в GitLab CI
делает шаг публикации автоматически, если в `apps/desktop/release/` есть свежие
артефакты (обычно их кладёт сборка по тегу `v*`).

Подробности — в [`apps/web/public/desktop/README.md`](apps/web/public/desktop/README.md).
