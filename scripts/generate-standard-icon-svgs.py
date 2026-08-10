#!/usr/bin/env python3
"""Генерация индивидуальных SVG-иконок для замены «стандартных» иконок проекта.

«Стандартные» иконки (системные эмодзи ОС, текстовые символы Unicode и иконки
lucide-react) задокументированы в аудите docs/explainers/standard-icons.md.
Для каждой из них здесь нарисован собственный SVG в едином стиле проекта,
совпадающем с компонентами ConnectIcons.tsx:

    viewBox="0 0 24 24"  fill="none"  stroke="currentColor"
    stroke-width="1.9"   stroke-linecap="round"  stroke-linejoin="round"

Иконки используют currentColor, поэтому они наследуют цвет текста и работают
в светлой/тёмной теме — так же, как остальные иконки ConnectIcons.

Запуск:  python scripts/generate-standard-icon-svgs.py
Результат: apps/web/public/icons/svg/*.svg  +  README.md  +  preview.html
"""

from __future__ import annotations

import os
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "icons" / "svg"

STROKE_WIDTH = 1.9

# name, замещаемый глиф(ы), категория, человекочитаемое назначение, тело SVG (paths),
# места использования в коде (из docs/explainers/standard-icons.md)
ICONS: list[dict] = [
    # ── 1. Эмодзи ОС ──────────────────────────────────────────────────────
    {
        "name": "folder",
        "glyph": "📁",
        "cat": "Эмодзи ОС",
        "purpose": "Папка / файловый канал",
        "body": [
            'M3 7a2 2 0 0 1 2-2h3.6a1 1 0 0 1 .8.4L11 7h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
        ],
        "uses": ["GroupListPanel.tsx:492", "DocsPanel.tsx:92", "DocsPanel.tsx:110"],
    },
    {
        "name": "folder-open",
        "glyph": "📂",
        "cat": "Эмодзи ОС",
        "purpose": "Раскрытая папка / рубрика статьи",
        "body": [
            'M4 8V7a2 2 0 0 1 2-2h3.6a1 1 0 0 1 .8.4L12 7h5a2 2 0 0 1 2 2v1',
            'M3.4 10.6h17.2a1 1 0 0 1 .96 1.27l-1.7 6A2 2 0 0 1 17.9 19H6a2 2 0 0 1-2-1.7l-1-6a1 1 0 0 1 .4-.7z',
        ],
        "uses": ["WikiPanel.tsx:169"],
    },
    {
        "name": "plus",
        "glyph": "➕",
        "cat": "Эмодзи ОС",
        "purpose": "Добавить (группа, пункт меню)",
        "body": ['M12 5v14', 'M5 12h14'],
        "uses": ["GroupListPanel.tsx:586", "GroupHeaderMenu.tsx:225"],
    },
    {
        "name": "file",
        "glyph": "📄",
        "cat": "Эмодзи ОС",
        "purpose": "Документ / файл в задаче",
        "body": [
            'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
            'M14 3v5h5',
            'M9 13h6',
            'M9 16.5h4',
        ],
        "uses": ["DocsPanel.tsx:23", "TasksPanel.tsx:1076", "TasksPanel.tsx:1115"],
    },
    {
        "name": "image",
        "glyph": "🖼",
        "cat": "Эмодзи ОС",
        "purpose": "Изображение (тип файла)",
        "body": [
            'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z',
            'M8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
            'M4 17l4.5-4.5 3.5 3.5 3-3L20 16.5',
        ],
        "uses": ["DocsPanel.tsx:26"],
    },
    {
        "name": "paperclip",
        "glyph": "📎",
        "cat": "Эмодзи ОС",
        "purpose": "Вложение",
        "body": [
            'M20 11.6l-8.4 8.4a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8',
        ],
        "uses": ["DocsPanel.tsx:29", "TasksPanel.tsx:467", "TasksPanel.tsx:829", "TasksPanel.tsx:1251"],
    },
    {
        "name": "trash",
        "glyph": "🗑",
        "cat": "Эмодзи ОС",
        "purpose": "Удалить",
        "body": [
            'M4 7h16',
            'M9 7V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5V7',
            'M6 7l1 12a2 2 0 0 0 2 1.9h6a2 2 0 0 0 2-1.9l1-12',
            'M10 11v6',
            'M14 11v6',
        ],
        "uses": ["DocsPanel.tsx:129", "MessageArea.tsx:66", "CalendarPanel.tsx:164"],
    },
    {
        "name": "gear",
        "glyph": "⚙",
        "cat": "Эмодзи ОС",
        "purpose": "Настройки",
        "body": [
            'M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z',
            ('M19.4 13a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 '
             '1.7 1.7 0 0 0-1 1.56V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06'
             'a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H3a2 2 0 0 1 0-4h.09'
             'A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9'
             'a1.7 1.7 0 0 0 1-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06'
             'a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 0 1 0 4h-.09'
             'a1.7 1.7 0 0 0-1.51 1z'),
        ],
        "uses": ["GroupHeaderMenu.tsx:230", "connect/page.tsx:668"],
    },
    {
        "name": "bell",
        "glyph": "🔔",
        "cat": "Эмодзи ОС",
        "purpose": "Уведомления",
        "body": [
            'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6',
            'M10 18a2 2 0 0 0 4 0',
        ],
        "uses": ["GroupHeaderMenu.tsx:235", "settings/notifications/page.tsx:24", "settings/notifications/page.tsx:28", "settings/notifications/page.tsx:185"],
    },
    {
        "name": "pencil",
        "glyph": "✏",
        "cat": "Эмодзи ОС",
        "purpose": "Редактировать",
        "body": [
            'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
            'M14 6l4 4',
        ],
        "uses": ["CalendarPanel.tsx:163", "games/velderan/admin/page.tsx:262", "games/velderan/admin/page.tsx:437"],
    },
    {
        "name": "card-index",
        "glyph": "🗂",
        "cat": "Эмодзи ОС",
        "purpose": "Категория канала",
        "body": [
            'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z',
            'M4 11h16',
            'M10 6V4.5A.5.5 0 0 1 10.5 4h3a.5.5 0 0 1 .5.5V6',
        ],
        "uses": ["ChannelSettingsModal.tsx:162"],
    },
    {
        "name": "star",
        "glyph": "⭐",
        "cat": "Эмодзи ОС",
        "purpose": "Избранное / реакция (контент пикера)",
        "body": [
            'M12 3.5l2.6 5.28 5.82.85-4.21 4.1.99 5.79L12 17.25l-5.2 2.76.99-5.79-4.21-4.1 5.82-.85L12 3.5z',
        ],
        "uses": ["EmojiPicker.tsx:34-35 (контент)"],
    },
    {
        "name": "lock",
        "glyph": "🔒",
        "cat": "Эмодзи ОС",
        "purpose": "Приватный канал",
        "body": [
            'M5 11.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7.5z',
            'M8 9.5V8a4 4 0 1 1 8 0v1.5',
            'M12 14.5v2',
        ],
        "uses": ["VoiceChannel.tsx:324"],
    },
    # ── 2. Текстовые символы Unicode ──────────────────────────────────────
    {
        "name": "chevron-right",
        "glyph": "▸",
        "cat": "Символ Unicode",
        "purpose": "Свернуть / развернуть папку",
        "body": ['M9 5.5l6.5 6.5L9 18.5'],
        "uses": ["GroupListPanel.tsx:484"],
    },
    {
        "name": "chevron-down",
        "glyph": "▾ / ChevronDown",
        "cat": "Символ Unicode / lucide",
        "purpose": "Раскрытие меню",
        "body": ['M5.5 9l6.5 6.5L18.5 9'],
        "uses": ["GroupHeaderMenu.tsx:205", "Navbar.tsx:246 (lucide ChevronDown)"],
    },
    {
        "name": "close",
        "glyph": "✕ / × / X",
        "cat": "Символ Unicode / lucide",
        "purpose": "Закрыть / убрать",
        "body": ['M6 6l12 12', 'M18 6L6 18'],
        "uses": [
            "MessageArea.tsx:1438", "MessageArea.tsx:1466", "MessageArea.tsx:1513",
            "TasksPanel.tsx:810", "TasksPanel.tsx:877", "TasksPanel.tsx:916",
            "ChannelTools.tsx:143", "DocsPanel.tsx:169", "connect/page.tsx:924",
            "page.tsx:427", "admin/services:146", "games/velderan/page.tsx:168",
            "games/velderan/page.tsx:195", "games/velderan/page.tsx:234", "games/velderan/admin:451",
            "dm/DMMessageComposer.tsx:187", "dm/DMMessageList.tsx:343", "workspace/cards.tsx:752",
            "admin/users:281", "Navbar.tsx:316 (lucide X)",
        ],
    },
    {
        "name": "check",
        "glyph": "✓",
        "cat": "Символ Unicode",
        "purpose": "Статус / отметка выбора",
        "body": ['M5 12.5l4.5 4.5L19 7'],
        "uses": [
            "MessageArea.tsx:1164", "MessageHoverToolbar.tsx:176", "admin/users:280",
            "admin/ai:139", "games/velderan/admin:424", "games/velderan/room/[id]:516",
            "settings/page.tsx:575", "dm/DMMessageList.tsx:342", "profile/ConnectProfileSettings.tsx:341",
        ],
    },
    {
        "name": "arrow-right",
        "glyph": "→",
        "cat": "Символ Unicode",
        "purpose": "Переход",
        "body": ['M4 12h15', 'M13 6l6 6-6 6'],
        "uses": [
            "MessageArea.tsx:1614", "ModulesPanel.tsx:47", "page.tsx:452", "page.tsx:456",
            "admin/logs:227", "dm/DMThreadPanel.tsx:89",
        ],
    },
    {
        "name": "arrow-left",
        "glyph": "←",
        "cat": "Символ Unicode",
        "purpose": "Назад",
        "body": ['M20 12H5', 'M11 6l-6 6 6 6'],
        "uses": [
            "TasksPanel.tsx:981", "ChannelTools.tsx:125", "AppealsPanel.tsx:119", "AppealsPanel.tsx:162",
            "WikiPanel.tsx:102", "admin/appeals:87", "admin/broadcast:91", "admin/logs:116",
            "admin/logs:220", "admin/premium:78", "auth/signin:490", "auth/signin:606",
            "games/velderan/admin:253", "games/velderan/play/[id]:550",
        ],
    },
    # ── 3. lucide-react ───────────────────────────────────────────────────
    {
        "name": "search",
        "glyph": "Search",
        "cat": "lucide-react",
        "purpose": "Поиск",
        "body": ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
        "uses": ["Navbar.tsx:183"],
    },
    {
        "name": "sun",
        "glyph": "Sun",
        "cat": "lucide-react",
        "purpose": "Светлая тема",
        "body": [
            'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
            'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4',
            'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4',
        ],
        "uses": ["Navbar.tsx:196"],
    },
    {
        "name": "moon",
        "glyph": "Moon",
        "cat": "lucide-react",
        "purpose": "Тёмная тема",
        "body": ['M20 14.5A7.5 7.5 0 1 1 9.5 4 6 6 0 0 0 20 14.5z'],
        "uses": ["Navbar.tsx:198"],
    },
    {
        "name": "square-pen",
        "glyph": "SquarePen",
        "cat": "lucide-react",
        "purpose": "Редактирование (написать)",
        "body": [
            'M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6',
            'M18.4 3.6a2.1 2.1 0 0 1 3 3L12 16l-4 1 1-4 9.4-9.4z',
        ],
        "uses": ["Navbar.tsx:213"],
    },
    {
        "name": "log-out",
        "glyph": "LogOut",
        "cat": "lucide-react",
        "purpose": "Выход",
        "body": [
            'M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3',
            'M16 17l5-5-5-5',
            'M21 12H9',
        ],
        "uses": ["Navbar.tsx:288"],
    },
    {
        "name": "menu",
        "glyph": "Menu",
        "cat": "lucide-react",
        "purpose": "Бургер-меню",
        "body": ['M4 7h16', 'M4 12h16', 'M4 17h16'],
        "uses": ["Navbar.tsx:318"],
    },
    {
        "name": "send",
        "glyph": "Send",
        "cat": "lucide-react",
        "purpose": "Отправить сообщение AI",
        "body": ['M21 3L3 10.5l7.2 2.3L12.5 20 21 3z', 'M10.2 12.8L21 3'],
        "uses": ["AiChatPanel.tsx:335"],
    },
]


def svg_markup(icon: dict) -> str:
    paths = "\n".join(f'  <path d="{d}" />' for d in icon["body"])
    glyph = icon["glyph"]
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"\n'
        f'     fill="none" stroke="currentColor" stroke-width="{STROKE_WIDTH}"\n'
        f'     stroke-linecap="round" stroke-linejoin="round"\n'
        f'     role="img" aria-label="{icon["name"]}">\n'
        f'  <title>{icon["name"]} — заменяет «{glyph}» ({icon["purpose"]})</title>\n'
        f'{paths}\n'
        f'</svg>\n'
    )


def write_svgs() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for icon in ICONS:
        (OUT_DIR / f'{icon["name"]}.svg').write_text(svg_markup(icon), encoding="utf-8")


def write_readme() -> None:
    lines = [
        "# Индивидуальные SVG-иконки (замена стандартных)",
        "",
        "Здесь собраны собственные SVG-иконки, нарисованные взамен «стандартных» —",
        "системных эмодзи ОС, текстовых символов Unicode и иконок `lucide-react`,",
        "перечисленных в аудите [`docs/explainers/standard-icons.md`](../../../../docs/explainers/standard-icons.md).",
        "",
        "Все иконки выполнены в едином стиле проекта (как `ConnectIcons.tsx`):",
        "`viewBox 0 0 24 24`, `fill=none`, `stroke=currentColor`, `stroke-width=1.9`,",
        "скруглённые концы. Благодаря `currentColor` они наследуют цвет текста и работают",
        "в светлой/тёмной теме. Предпросмотр — [`preview.html`](./preview.html).",
        "",
        "Перегенерация: `python scripts/generate-standard-icon-svgs.py`",
        "",
        "| Файл | Заменяет | Категория | Назначение | Места в коде |",
        "|---|---|---|---|---|",
    ]
    for icon in ICONS:
        uses = ", ".join(f"`{u}`" for u in icon["uses"])
        lines.append(
            f'| `{icon["name"]}.svg` | {icon["glyph"]} | {icon["cat"]} | {icon["purpose"]} | {uses} |'
        )
    lines += [
        "",
        f"**Всего иконок: {len(ICONS)}.**",
        "",
        "> Иконка `star.svg` покрывает содержимое `EmojiPicker` — это легитимный контент",
        "> (реакции), а не UI-иконка; SVG добавлен для полноты каталога.",
        "",
    ]
    (OUT_DIR / "README.md").write_text("\n".join(lines), encoding="utf-8")


def write_preview() -> None:
    cards = []
    for icon in ICONS:
        cards.append(
            f'    <figure class="cell">\n'
            f'      <div class="glyph">{svg_markup(icon).strip()}</div>\n'
            f'      <figcaption>\n'
            f'        <code>{icon["name"]}.svg</code>\n'
            f'        <span class="rep">заменяет {icon["glyph"]}</span>\n'
            f'        <span class="cat">{icon["cat"]}</span>\n'
            f'      </figcaption>\n'
            f'    </figure>'
        )
    grid = "\n".join(cards)
    html = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Стандартные иконки → индивидуальный SVG</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font-family: system-ui, sans-serif; margin: 0; padding: 32px;
         background: #0b0f14; color: #e6edf3; }}
  h1 {{ font-size: 20px; font-weight: 600; }}
  p.sub {{ color: #9aa7b2; margin-top: 4px; }}
  .toolbar {{ margin: 16px 0 24px; display: flex; gap: 12px; align-items: center; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }}
  .cell {{ margin: 0; padding: 16px; border: 1px solid #1e2a36; border-radius: 12px;
          background: #111820; display: flex; flex-direction: column; align-items: center; gap: 10px; }}
  .glyph {{ color: #d7e2ee; }}
  .glyph svg {{ width: 40px; height: 40px; }}
  figcaption {{ display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; }}
  code {{ font-size: 12px; color: #7ee0ff; }}
  .rep {{ font-size: 12px; color: #cbd5e1; }}
  .cat {{ font-size: 11px; color: #7d8b98; }}
</style>
</head>
<body>
  <h1>Индивидуальные SVG-иконки взамен стандартных</h1>
  <p class="sub">{len(ICONS)} иконок в стиле ConnectIcons (24×24, currentColor, stroke 1.9). Источник аудита: docs/explainers/standard-icons.md</p>
  <div class="grid">
{grid}
  </div>
</body>
</html>
"""
    (OUT_DIR / "preview.html").write_text(html, encoding="utf-8")


def main() -> None:
    write_svgs()
    write_readme()
    write_preview()
    print(f"Готово: {len(ICONS)} SVG + README.md + preview.html -> {OUT_DIR}")


if __name__ == "__main__":
    main()
