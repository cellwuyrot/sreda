# Индивидуальные SVG-иконки (замена стандартных)

Здесь собраны собственные SVG-иконки, нарисованные взамен «стандартных» —
системных эмодзи ОС, текстовых символов Unicode и иконок `lucide-react`,
перечисленных в аудите [`docs/explainers/standard-icons.md`](../../../../docs/explainers/standard-icons.md).

Все иконки выполнены в едином стиле проекта (как `ConnectIcons.tsx`):
`viewBox 0 0 24 24`, `fill=none`, `stroke=currentColor`, `stroke-width=1.9`,
скруглённые концы. Благодаря `currentColor` они наследуют цвет текста и работают
в светлой/тёмной теме. Предпросмотр — [`preview.html`](./preview.html).

Перегенерация: `python scripts/generate-standard-icon-svgs.py`

| Файл | Заменяет | Категория | Назначение | Места в коде |
|---|---|---|---|---|
| `folder.svg` | 📁 | Эмодзи ОС | Папка / файловый канал | `GroupListPanel.tsx:492`, `DocsPanel.tsx:92`, `DocsPanel.tsx:110` |
| `folder-open.svg` | 📂 | Эмодзи ОС | Раскрытая папка / рубрика статьи | `WikiPanel.tsx:169` |
| `plus.svg` | ➕ | Эмодзи ОС | Добавить (группа, пункт меню) | `GroupListPanel.tsx:586`, `GroupHeaderMenu.tsx:225` |
| `file.svg` | 📄 | Эмодзи ОС | Документ / файл в задаче | `DocsPanel.tsx:23`, `TasksPanel.tsx:1076`, `TasksPanel.tsx:1115` |
| `image.svg` | 🖼 | Эмодзи ОС | Изображение (тип файла) | `DocsPanel.tsx:26` |
| `paperclip.svg` | 📎 | Эмодзи ОС | Вложение | `DocsPanel.tsx:29`, `TasksPanel.tsx:467`, `TasksPanel.tsx:829`, `TasksPanel.tsx:1251` |
| `trash.svg` | 🗑 | Эмодзи ОС | Удалить | `DocsPanel.tsx:129`, `MessageArea.tsx:66`, `CalendarPanel.tsx:164` |
| `gear.svg` | ⚙ | Эмодзи ОС | Настройки | `GroupHeaderMenu.tsx:230`, `connect/page.tsx:668` |
| `bell.svg` | 🔔 | Эмодзи ОС | Уведомления | `GroupHeaderMenu.tsx:235`, `settings/notifications/page.tsx:24`, `settings/notifications/page.tsx:28`, `settings/notifications/page.tsx:185` |
| `pencil.svg` | ✏ | Эмодзи ОС | Редактировать | `CalendarPanel.tsx:163`, `games/velderan/admin/page.tsx:262`, `games/velderan/admin/page.tsx:437` |
| `card-index.svg` | 🗂 | Эмодзи ОС | Категория канала | `ChannelSettingsModal.tsx:162` |
| `star.svg` | ⭐ | Эмодзи ОС | Избранное / реакция (контент пикера) | `EmojiPicker.tsx:34-35 (контент)` |
| `lock.svg` | 🔒 | Эмодзи ОС | Приватный канал | `VoiceChannel.tsx:324` |
| `chevron-right.svg` | ▸ | Символ Unicode | Свернуть / развернуть папку | `GroupListPanel.tsx:484` |
| `chevron-down.svg` | ▾ / ChevronDown | Символ Unicode / lucide | Раскрытие меню | `GroupHeaderMenu.tsx:205`, `Navbar.tsx:246 (lucide ChevronDown)` |
| `close.svg` | ✕ / × / X | Символ Unicode / lucide | Закрыть / убрать | `MessageArea.tsx:1438`, `MessageArea.tsx:1466`, `MessageArea.tsx:1513`, `TasksPanel.tsx:810`, `TasksPanel.tsx:877`, `TasksPanel.tsx:916`, `ChannelTools.tsx:143`, `DocsPanel.tsx:169`, `connect/page.tsx:924`, `page.tsx:427`, `admin/services:146`, `games/velderan/page.tsx:168`, `games/velderan/page.tsx:195`, `games/velderan/page.tsx:234`, `games/velderan/admin:451`, `dm/DMMessageComposer.tsx:187`, `dm/DMMessageList.tsx:343`, `workspace/cards.tsx:752`, `admin/users:281`, `Navbar.tsx:316 (lucide X)` |
| `check.svg` | ✓ | Символ Unicode | Статус / отметка выбора | `MessageArea.tsx:1164`, `MessageHoverToolbar.tsx:176`, `admin/users:280`, `admin/ai:139`, `games/velderan/admin:424`, `games/velderan/room/[id]:516`, `settings/page.tsx:575`, `dm/DMMessageList.tsx:342`, `profile/ConnectProfileSettings.tsx:341` |
| `arrow-right.svg` | → | Символ Unicode | Переход | `MessageArea.tsx:1614`, `ModulesPanel.tsx:47`, `page.tsx:452`, `page.tsx:456`, `admin/logs:227`, `dm/DMThreadPanel.tsx:89` |
| `arrow-left.svg` | ← | Символ Unicode | Назад | `TasksPanel.tsx:981`, `ChannelTools.tsx:125`, `AppealsPanel.tsx:119`, `AppealsPanel.tsx:162`, `WikiPanel.tsx:102`, `admin/appeals:87`, `admin/broadcast:91`, `admin/logs:116`, `admin/logs:220`, `admin/premium:78`, `auth/signin:490`, `auth/signin:606`, `games/velderan/admin:253`, `games/velderan/play/[id]:550` |
| `search.svg` | Search | lucide-react | Поиск | `Navbar.tsx:183` |
| `sun.svg` | Sun | lucide-react | Светлая тема | `Navbar.tsx:196` |
| `moon.svg` | Moon | lucide-react | Тёмная тема | `Navbar.tsx:198` |
| `square-pen.svg` | SquarePen | lucide-react | Редактирование (написать) | `Navbar.tsx:213` |
| `log-out.svg` | LogOut | lucide-react | Выход | `Navbar.tsx:288` |
| `menu.svg` | Menu | lucide-react | Бургер-меню | `Navbar.tsx:318` |
| `send.svg` | Send | lucide-react | Отправить сообщение AI | `AiChatPanel.tsx:335` |

**Всего иконок: 26.**

> Иконка `star.svg` покрывает содержимое `EmojiPicker` — это легитимный контент
> (реакции), а не UI-иконка; SVG добавлен для полноты каталога.
