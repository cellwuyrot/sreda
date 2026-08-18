# TrioZ Connect — Desktop

Десктоп-клиент для коммуникационной платформы **TrioZ Connect**, построенный
как **тонкая Electron-обёртка** поверх существующего веб-приложения
([`acoulbot/trioztest`](https://github.com/acoulbot/trioztest)).

Приложение **не дублирует** бизнес-логику: весь backend, REST API, Socket.IO и
Prisma переиспользуются без изменений. Десктоп-оболочка загружает тот же
веб-фронтенд (по умолчанию `https://trioz.ru`) и добавляет нативные
возможности, которых нет в браузере.

## Возможности

| Возможность | Реализация |
|---|---|
| **Загрузка веб-фронтенда** | `BrowserWindow` открывает `TRIOZ_APP_URL`; внешние ссылки уходят в системный браузер |
| **Тёмная рамка окна** | `nativeTheme.themeSource = "dark"` — системный тайтлбар (кнопки свернуть / развернуть в окно / закрыть) рисуется в тёмной палитре проекта вместо белого |
| **Системные уведомления** | Main-процесс держит авторизованный Socket.IO-клиент и слушает `new-notification` / `dm-message`, показывая нативные уведомления, когда окно не в фокусе |
| **Статус-бар уведомлений** | Тонкая полоса внизу окна показывает входящие уведомления и личные сообщения в фирменных цветах — всегда, даже когда окно в фокусе. Внедряется из preload (Shadow DOM + CSSOM), поэтому работает поверх удалённого фронтенда независимо от его CSP |
| **Трей + бейдж непрочитанных** | Иконка в трее; счётчик берётся из `/api/channels/unread` (канальные) + живой подсчёт DM по сокету |
| **Глобальные горячие клавиши** | Переключение мьюта (`Ctrl/Cmd+Shift+M` по умолчанию); импульс push-to-talk |
| **Захват экрана** | `setDisplayMediaRequestHandler` + `desktopCapturer`: список экранов и окон уходит в приложение, там же выбираются источник, качество и звук — оболочка отдаёт выбранное, `getDisplayMedia()` из `VoiceContext` работает как есть |
| **Deep links `trioz://`** | `trioz://invite/<code>` → переход на `/invite/<code>`; single-instance forwarding |
| **Автозапуск** | `setLoginItemSettings` (Windows/macOS), `~/.config/autostart` (Linux) |
| **Авто-обновление** | `electron-updater` (только в собранных сборках) |
| **Безопасная сессия** | Логин идёт через обычный веб-флоу NextAuth; cookie-сессия хранится в дисковой партиции Electron и переиспользуется для сокета |

## Архитектура

```
src/
├── main/            # Main-процесс Electron
│   ├── index.ts             # точка входа, жизненный цикл, single-instance
│   ├── mainWindow.ts        # окно, сохранение размеров, close-to-tray
│   ├── config.ts            # настройки (electron-store) + ENV-оверрайды
│   ├── session.ts           # чтение cookie NextAuth из партиции Electron
│   ├── notificationBridge.ts# авторизованный Socket.IO-клиент → нативные уведомления
│   ├── badge.ts             # счётчик непрочитанных (REST + сокет)
│   ├── tray.ts              # иконка и меню в трее
│   ├── screenShare.ts       # разрешения, список источников, захват выбранного
│   ├── shortcuts.ts         # глобальные горячие клавиши
│   ├── deepLinks.ts         # протокол trioz://
│   ├── updater.ts           # electron-updater
│   ├── autoLaunch.ts        # автозапуск (Win/macOS/Linux)
│   └── ipc.ts               # IPC-обработчики
├── preload/
│   ├── index.ts             # мост window.triozDesktop (contextBridge) + инициализация статус-бара
│   ├── statusBar.ts         # внутренний статус-бар уведомлений (Shadow DOM + CSSOM)
│   └── overlay.ts           # мост для окна оверлея голосового канала
└── shared/
    ├── constants.ts         # имена каналов IPC и событий сокета
    └── types.ts             # общие типы
build/               # иконки для сборки (electron-builder)
resources/           # иконки для рантайма (окно, трей)
```

## Разработка

```bash
npm install           # поставит Electron и зависимости

# указать бэкенд (по умолчанию https://trioz.ru):
export TRIOZ_APP_URL="http://localhost:3000"

npm run dev           # сборка + запуск с DevTools
npm run typecheck     # проверка типов
npm run lint          # ESLint
```

> Бэкенд (`trioztest`) запускается **отдельно** (`npm run dev` в том репозитории).
> Десктоп-оболочка лишь подключается к нему по `TRIOZ_APP_URL`.

> ⚠️ **Preload собирается в один файл (esbuild).** Окно создаётся с `sandbox: true`,
> а в песочнице у preload-скрипта `require()` доступен только для `electron` —
> относительные импорты (`../shared/constants`, `./statusBar`) в рантайме не
> резолвятся. Поэтому `npm run build` после `tsc` дополнительно бандлит
> `preload/index.ts` и `preload/overlay.ts` в самодостаточные файлы
> (`npm run bundle:preload`). Main-процесс не в песочнице и по-прежнему
> компилируется обычным `tsc`.

## Сборка инсталляторов

> ⚠️ Консоль нужна только чтобы **собрать** установщик (шаг разработчика).
> Клиент консоль не видит — он скачивает один файл и запускает двойным кликом.

```bash
npm run dist          # electron-builder для текущей платформы
npm run dist:dir      # распакованная сборка без инсталлятора
```

Артефакты складываются в `release/`. Конфигурация — в `electron-builder.yml`.

## Распространение клиентам

Есть два формата установщика для Windows (оба настроены в `electron-builder.yml`):

| Формат | Файл | Как работает |
|---|---|---|
| **Онлайн-установщик** (`nsis-web`) | `TrioZ Connect Web Setup <версия>.exe` (~1–2 МБ) | Клиент скачивает маленький файл → тот **подтягивает пакет приложения с вашего сервера** и ставит его. Модель, как у Discord. |
| **Автономный установщик** (`nsis`) | `TrioZ Connect Setup <версия>.exe` (~90–120 МБ) | Один самодостаточный файл, не требует сервера во время установки. |

macOS → `.dmg`, Linux → `.AppImage` / `.deb` (тоже просто скачиваемые файлы).

### Сборка без консоли (GitHub Actions)

Чтобы не собирать локально, используйте облачную сборку — файл
`.github/workflows/release.yml`:

1. В GitHub откройте вкладку **Actions → «Build desktop installers» → «Run workflow»**
   (или создайте тег версии `v0.1.0`).
2. GitHub соберёт установщики под Windows/macOS/Linux на своих раннерах.
3. Скачайте готовые файлы со страницы запуска (или со страницы **Release**, если
   собирали по тегу).

### Как выложить и как клиент установит

1. Задайте в `electron-builder.yml` адрес вашего сервера в `publish.url` и
   `nsisWeb.appPackageUrl` (например `https://trioz.ru/desktop/`).
2. Соберите (см. выше) и **опубликуйте содержимое `release/` в хранилище
   раздачи** (`*.nsis.7z`, `*.blockmap`, `latest.yml` и сами установщики):
   - локально — `npm run desktop:publish` (копирует в `apps/web/public/desktop/`);
   - в Docker — `npm run desktop:publish:docker` (кладёт прямо в том
     `desktop_data`, из которого раздаёт контейнер).
   Подробнее — в [`apps/web/public/desktop/README.md`](../web/public/desktop/README.md).
3. Дайте клиенту ссылку на `…Web Setup <версия>.exe`. Он скачивает файл,
   запускает, установщик тянет пакет с сервера и ставит приложение.

### Обновления

`electron-updater` при каждом запуске проверяет `latest.yml` по тому же
`publish.url`, скачивает новую версию в фоне и ставит её при перезапуске.
Чтобы выпустить обновление — поднимите `version` в `package.json`, пересоберите
и снова залейте `release/` на сервер (или соберите по новому тегу).

> Для приватного репозитория вместо `provider: generic` можно указать
> `provider: github`, и файлы будут раздаваться из GitHub Releases.
> Подпись кода (Windows Authenticode / macOS notarization) настраивается
> отдельными секретами и нужна, чтобы у клиента не было предупреждений ОС и
> чтобы работало авто-обновление на macOS.

## Интеграция с веб-фронтендом (`window.triozDesktop`)

Веб-приложение может определить, что запущено в десктопе, и подписаться на
нативные хуки. Это **опционально** — без интеграции всё уже работает (окно,
уведомления, трей, бейдж, захват экрана, deep links).

```ts
if (window.triozDesktop?.isDesktop) {
  // точный счётчик непрочитанных (заменяет опрос REST в оболочке)
  window.triozDesktop.setBadgeCount(totalUnread);

  // глобальный хоткей мьюта / push-to-talk
  const off1 = window.triozDesktop.onToggleMute(() => voice.toggleMute());
  const off2 = window.triozDesktop.onPushToTalk(() => voice.pulseTransmit());

  // переход по deep link trioz://invite/<code>
  const off3 = window.triozDesktop.onDeepLink(({ path }) => router.push(path));

  // входящие уведомления (оболочка уже показывает их в своём статус-баре;
  // веб-приложение может дополнительно отрисовать собственный тост)
  const off4 = window.triozDesktop.onNotification((n) => toast(n.title, n.body));
}
```

## Конфигурация окружения

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `TRIOZ_APP_URL` | URL веб-фронтенда | `https://trioz.ru` |
| `TRIOZ_DEV` | `1` — открыть DevTools и включить подробный лог | — |

Пользовательские настройки (автозапуск, трей, уведомления, хоткеи) хранятся
через `electron-store` в userData-папке ОС.
