# TrioZ

Экосистема проектов Т.Р.И.О.Z: мессенджер, база знаний, настольная игра и витрина проектов — в одном приложении, веб и десктоп.

Основная часть — **TZ.Connect**: чат с сообществами, каналами, голосовой связью, демонстрацией экрана и сквозным шифрованием личной переписки.

## Что внутри

Монорепозиторий на npm workspaces. Три приложения и общий контракт между ними:

| Где | Что это |
|---|---|
| `apps/web` | Next.js 16, App Router. Само приложение и весь API |
| `apps/desktop` | Electron-оболочка TZ.Connect с автообновлением |
| `apps/android` | Android-оболочка |
| `packages/shared` | Общий контракт Socket.IO: путь, имена событий, типы |

Под капотом: TypeScript, Tailwind, Prisma и PostgreSQL, NextAuth, Socket.IO в собственном сервере (`apps/web/server.ts`), Redis для лимитов и сессий, WebRTC для голоса и показа экрана.

## Запуск для разработки

Нужны Node.js 20 и PostgreSQL. Redis необязателен — без него лимиты считаются в памяти процесса.

```bash
npm install
cp apps/web/.env.example apps/web/.env   # заполнить DATABASE_URL и секреты
npm run migrate
npm run seed
npm run dev
```

Приложение поднимется на `http://localhost:3000`.

Важно: переменные окружения читаются из `apps/web/.env`, а не из корня — приложение запускается как `npm run start -w apps/web`, и рабочим каталогом становится `apps/web`.

## Команды

```bash
npm run dev        # разработка
npm run build      # сборка: сначала packages/shared, затем apps/web
npm run start      # прод-запуск (apps/web/server.ts)
npm run lint       # eslint по apps/web
npm run migrate    # prisma migrate deploy
npm run typecheck  # проверка типов десктоп-оболочки

npm run desktop:dev      # Electron локально
npm run desktop:release  # сборка установщиков с автоверсией и публикация
```

## Документация

| Документ | О чём |
|---|---|
| [Установка и деплой](docs/install.md) | Пустой сервер с нуля, Docker, обновление, переменные окружения |
| [Деплой через CI](docs/deploy.md) | Автоматическая выкладка |
| [Разборы решений](docs/explainers/) | Почему код устроен именно так: модерация, почта, кастомизация чата и прочее |
| [История изменений](docs/changelog.md) | Что менялось |
| [AGENTS.md](AGENTS.md) | Правила работы с репозиторием: стиль, ограничения, грабли |

Разборы в `docs/explainers/` стоит читать перед правкой соответствующей части: там объяснено не «что сделано», а почему сделано так и что ломалось раньше.

## Лицензия

Частный проект. Все права защищены.
