# 0.3.3 — иконка приложения и версия

Логотип приложения теперь один на весь проект: `docs/logostol.png` (1024×1024,
с прозрачностью). Копий картинки в репозитории больше нет — каждая сборка берёт
её из этого файла, поэтому расходиться нечему.

- `apps/desktop/scripts/prepare-icons.mjs` (новый) — раскладывает исходник в
  `build/icon.png` и `resources/` перед сборкой (`npm run build`). Файл для
  Windows electron-builder делает сам из png, отдельно он не хранится.
- `apps/desktop/src/main/tray.ts` — значок трея уменьшается на лету, а чёрный
  силуэт для строки меню macOS считается из той же картинки: отдельный
  `trayTemplate.png` больше не нужен.
- `apps/android/app/build.gradle.kts` — задача `syncLauncherIcon` копирует
  логотип в ресурсы перед сборкой; адаптивная иконка использует его передним
  слоем с отступом под маску. Прозрачные места показывают фоновый цвет иконки.
- Версия приложения: десктоп `0.3.3`, Android `versionName 0.3.3`
  (`versionCode 2` — иначе установщик не примет обновление).
- `scripts/generate-icons.py` — остались только фавиконы сайта, исходник по
  умолчанию `docs/logostol.png`. Запуск: `python scripts/generate-icons.py`.

Фавиконы сайта — единственное, что нужно пересобрать этой командой вручную и
закоммитить: это готовые картинки, и автоматики для них нет.

# Изменения: роли, окно настроек группы, баны, иконки

## 1. Багфикс: роль «Админ» нельзя было выдать
- `apps/web/src/app/api/groups/[id]/members/[memberId]/route.ts` — PATCH принимал только MODERATOR/MEMBER, ADMIN отклонялся. Теперь: создатель выдаёт Админ/Модератор/Участник; админ управляет ролями ниже себя; нельзя менять себя и равных/выше по рангу. Добавлены live-обновления через сокеты (group-updated).
- `apps/web/src/app/api/groups/[id]/route.ts` — сопутствующий баг: в PUT (редактирование группы) ADMIN был исключён из проверки прав — исправлено.
- `apps/web/src/app/api/groups/[id]/transfer-ownership/route.ts` (новый) — передача группы: цель становится OWNER, ownerId обновляется, бывший владелец — ADMIN (транзакция + аудит-лог).

## 2. Новое окно настроек группы (как настройки профиля)
- `apps/web/src/components/connect/GroupSettingsModal.tsx` (новый) — полноэкранное окно с группированным сайдбаром в стиле /settings, закрытие по ESC/круглой кнопке.
  Секции: Обзор (имя/иконка/описание/разделы + сводка), Правила, Рабочая среда, Участники (поиск, роли вкл. Админ, исключение, бан), Роли (иерархия + роли-метки), Забаненные, Приглашения, Опасная зона (передача группы, удаление).
- `apps/web/src/components/connect/GroupDialogs.tsx` — старое модальное окно удалено (реэкспорт нового — импорты в connect/page.tsx не меняются); в панели участников добавлен значок Админа (красный щит).

## 3. Забаненные пользователи
- `apps/web/prisma/schema.prisma` — новая модель GroupBan (причина, кто забанил, дата; unique groupId+userId). Применить: `npx prisma migrate dev -n group_bans` (или `npx prisma db push`).
- `apps/web/src/app/api/groups/[id]/bans/route.ts` (новый) — GET список / POST бан (исключение + запись, с учётом иерархии ролей).
- `apps/web/src/app/api/groups/[id]/bans/[banId]/route.ts` (новый) — DELETE разбан (модератор снимает только свои баны).
- `apps/web/src/app/api/invites/[code]/route.ts` — забаненный не может войти по инвайту (403).

## 4. Иконки и обновление приложения
- `scripts/generate-icons.py` (новый) — генерация всех фавиконов и значков из исходного PNG с сохранением прозрачности (без заливки в квадрат): favicon.ico/16/32, apple-touch-icon 180, icon-192/512, desktop build/icon.png + icon.ico, resources/icon.png, tray.png, trayTemplate.png.
  Иконки уже сгенерированы из `docs/explainers/fvcn.png` (1024×1024, RGBA, прозрачность сохранена) и включены в этот архив.
  Перегенерация при необходимости: `python scripts/generate-icons.py docs/explainers/fvcn.png`
- `apps/desktop/package.json` — версия 0.1.2 → 0.1.3, чтобы electron-updater раздал обновление с новыми иконками. После генерации иконок: `npm run dist` и выложить release/ на https://connect.trioz.ru/desktop/.
