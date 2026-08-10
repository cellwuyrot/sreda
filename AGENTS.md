# AGENTS.md — контекст для AI-агентов

Этот файл — точка входа для AI-агентов (Claude Code, Cursor, Copilot, Codex и др.),
работающих с репозиторием TrioZ. Прочитай его перед изменениями кода.

## Что это за проект

**TrioZ** — веб-экосистема проектов с dark-fantasy эстетикой: сайт-лендинг, мессенджер
**TZ.Connect** (каналы, группы, ЛС, голосовая связь через WebRTC), база знаний **TZ.Library**,
настольная онлайн-игра **Вельд'Эран**, AI-ассистент и админка. Язык интерфейса и документации — русский.

## Граф кодовой базы — используй его в первую очередь

В репозитории закоммичен **готовый индекс графа кода** для [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp):

```
.codebase-memory/graph.db.zst   — сжатый снапшот графа (узлы/связи, SQLite+zstd)
.codebase-memory/artifact.json  — метаданные: коммит, число узлов/связей
.cbmignore                      — что исключено из индекса (мёртвый код, ассеты)
.codebase-memory.json           — маппинг расширений (.mjs → javascript)
.mcp.json                       — конфиг MCP-сервера для агентов
.github/workflows/codebase-memory.yml — автообновление артефакта на push в main
```

Граф: **~5 400 узлов** (Function 1789, Variable 703, Field 690, File 515, Module 513,
Interface 284, Class 116, Channel 67 — события Socket.IO, Route 22) и **~12 500 связей**
(DEFINES, CALLS 2093, USAGE 3046, IMPORTS 1364, LISTENS_ON/EMITS — подписки и эмиты
Socket.IO, HTTP_CALLS, WRITES).

Это **на порядки дешевле по токенам**, чем обход файлов grep-ом: одна структурная
выборка вместо десятков чтений файлов.

### Как подключить

```bash
# установка (single static binary, локально, без зависимостей):
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
```

`.mcp.json` уже лежит в корне — MCP-клиенты (Claude Code и совместимые) подхватят
сервер автоматически. При первом `index_repository` артефакт из `.codebase-memory/`
импортируется, и доиндексируется только диф с текущим коммитом — полная переиндексация
не нужна.

### Рабочий цикл агента

1. `get_graph_schema` — посмотреть модель графа (запускай первым).
2. `search_graph` — найти символ: `{"project":"trioz","name_pattern":".*[Pp]ermission.*","label":"Function"}`.
3. `trace_path` — кто вызывает / что вызывает: `{"project":"trioz","function_name":"checkBan","direction":"inbound"}`.
4. `get_code_snippet` — исходник по qualified name: `trioz.apps.web.src.lib.rateLimit.rateLimit`.
5. `detect_changes` — blast radius твоего диффа перед коммитом.
6. `query_graph` — Cypher-запросы (read-only), примеры ниже.

Без MCP тот же набор доступен из CLI:

```bash
codebase-memory-mcp cli search_graph --project trioz --name-pattern ".*Handler.*" --label Function
codebase-memory-mcp cli trace_path --project trioz --function-name checkBan --direction inbound
codebase-memory-mcp cli query_graph --project trioz --query "MATCH (f:Function) RETURN f.name LIMIT 5"
```

### Проверенные примеры запросов для этого репозитория

```cypher
-- все Socket.IO-события (узлы Channel): join-channel, dm-typing, voice-offer…
MATCH (c:Channel) RETURN c.name

-- кто слушает конкретное событие
MATCH (f)-[:LISTENS_ON]->(c:Channel {name: "join-channel"}) RETURN f.qualified_name

-- кандидаты в мёртвый код
MATCH (f:Function) WHERE NOT EXISTS { (f)<-[:CALLS]-() } AND NOT EXISTS { (f)<-[:USAGE]-() }
RETURN f.qualified_name LIMIT 20

-- самые нагруженные функции (fan-in)
MATCH (f)<-[:CALLS]-() WHERE f:Function OR f:Method
RETURN f.name AS fn, count(*) AS callers ORDER BY callers DESC LIMIT 12
```

**Горячие точки** (высокий fan-in, меняй осторожно): `lib/banCheck.checkBan`,
`lib/rateLimit.rateLimit`, `lib/audit.logAction`, `lib/sanitize.sanitizeText`,
`lib/games/velderanMap.getActiveNodes`, `desktop/src/main/mainWindow.getMainWindow`.

### Поддержка графа в актуальном состоянии

Артефакт обновляется **автоматически**: workflow `.github/workflows/codebase-memory.yml`
переиндексирует репозиторий на каждый push в `main` и коммитит свежий `.codebase-memory/`
(коммит помечен `[skip ci]`, остальные пайплайны от него не запускаются). Вручную
поддерживать граф не нужно.

При долгой работе на фиче-ветке можно переиндексировать локально:

```bash
codebase-memory-mcp cli index_repository --repo-path . --name trioz --persistence true
```

Конфликты слияния артефакта исключены: `.codebase-memory/.gitattributes` задаёт `merge=ours`.

## Карта монорепозитория

npm workspaces (`packages/*`, `apps/*`) + отдельный Gradle-проект:

| Путь | Пакет | Что это |
|------|-------|---------|
| `apps/web` | `trioz` | Next.js 16 (App Router) + **кастомный сервер `server.ts`** (Next + Socket.IO + раздача `/uploads/*` и десктоп-инсталляторов в одном процессе) |
| `apps/desktop` | `trioz-connect-desktop` | Electron-оболочка **только** раздела `/connect` (лендинг/`/projects`/`/pero`/`/library` заблокированы) |
| `packages/shared` | `@trioz/shared` | Тонкий Socket.IO-контракт: `SOCKET_PATH=/api/socketio` + 2 события (`new-notification`, `dm-message`) для нативных уведомлений десктопа |
| `apps/android` | — | Нативный Android WebView-клиент `/connect` (Kotlin, **не входит** в npm workspaces) |

Инфраструктура: `Dockerfile` (4 стадии, прод запускает `npx tsx server.ts`),
`docker-compose.yml` (postgres, redis, coturn, app, nginx), `nginx.conf` (разводит
WebSocket `/api/socketio/` от HTTP), `turnserver.conf` (coturn для WebRTC),
`.gitlab-ci.yml` (основной CI/CD: lint → build → manual deploy), `.github/workflows/`
(CI + сборка десктоп-инсталляторов на 3 ОС).

## Команды

```bash
npm install          # зависимости всех workspaces
npm run dev          # build:shared + dev-сервер веба
npm run build        # build:shared + next build
npm run start        # прод: tsx apps/web/server.ts
npm run lint         # eslint веба
npm run migrate      # prisma migrate deploy
npm run seed         # сидер БД (пароли из .env)
npm run desktop:dev  # десктоп в dev-режиме
```

Перед любой сборкой web/desktop должен быть собран `@trioz/shared` (`npm run build:shared`) —
корневые скрипты делают это автоматически.

## Ключевые факты (то, что неочевидно из структуры)

1. **Прод — не `next start`**, а кастомный `apps/web/server.ts` (~800 строк): Next.js,
   Socket.IO (комнаты `dm-<userId>`, `channel-<id>`, `group-<id>`, `voice-<id>`),
   WebRTC-сигналинг (`voice-offer`/`voice-answer`/`ice-candidate`), плановые задачи
   (очистка файлов, отложенные сообщения).
2. **Голосовые комнаты хранятся in-memory** (`Map` в `server.ts`) — один Node-процесс,
   горизонтальное масштабирование без sticky sessions не поддерживается.
3. **Большинство Socket.IO-событий НЕ типизированы в `@trioz/shared`** — имена строками
   в `server.ts` и клиентах (`src/components/connect/*`, `src/contexts/VoiceContext.tsx`).
   Полный список событий — в графе: `MATCH (c:Channel) RETURN c.name`.
4. **Prisma**: живая схема — `apps/web/prisma/schema.prisma` (61 модель, 39 миграций).
   `schema-additions.prisma` и `prisma/migration.sql` — исторические памятки, **не** часть
   миграционной цепочки.
5. **Права доступа к каналам** считаются единой функцией `apps/web/src/lib/connectPermissions.ts` —
   используется и HTTP-роутами, и Socket.IO. Не дублируй логику прав.
6. **AI-ассистент конфигурируется через БД, а не env**: провайдер/модель/ключ/промпт — в таблице
   `SiteConfig` (ключ шифруется AES-256-GCM, `lib/encryption.ts`); вызовы — сырой `fetch`
   в `src/app/api/ai/chat/route.ts`, без SDK.
7. **Десктоп-инсталляторы раздаются с собственного сайта** (`/desktop/*` через `server.ts`,
   фид electron-updater `publish: generic`), а не с GitHub Releases. GitHub Actions только собирает.
8. **API-роуты защищаются связкой** `checkBan` + `rateLimit` + `logAction` + `sanitizeText` —
   при добавлении нового эндпоинта следуй этому же паттерну (примеры: соседние `route.ts`).
9. **`apps/web/public/uploads/` не в git** — там пользовательские файлы на сервере.
   Из-за этого **на сервере запрещён `git clean -fd`** (подробнее — `docs/deploy.md`).
10. **Эмодзи — фирменный SVG-пак** (25 штук, `TriozEmoji.tsx` + `public/emojis/trioz/`),
    Unicode-реакции рендерятся через него (`docs/emoji-pack.md`).

## Мусор и ловушки (не трогай / не редактируй)

- `apps/apps/` — **мёртвая директория** с устаревшими дублями кода (никем не импортируется).
  Не редактируй её по ошибке вместо `apps/web` / `apps/desktop`. Исключена из индекса графа.
- `apps/web/cm6.txt` — случайно закоммиченный текст changelog, не используется.
- Пустые файлы `git` и `main` в корне — случайный мусор от редиректа команды.
- `docs/explainers/*.md` — пост-фактум описания фич/фиксов; полезны как история решений,
  но не как актуальная спецификация.

## Соглашения

- UI-тексты, комментарии и документация — на русском языке.
- Стили — Tailwind CSS; анимации — Framer Motion; общие UI-компоненты — `src/components/ui/`.
- Раздел мессенджера — самый насыщенный домен: 48 компонентов в `src/components/connect/`,
  ~122 API-роута в `src/app/api/**`. Перед изменениями смотри blast radius через `detect_changes`.
