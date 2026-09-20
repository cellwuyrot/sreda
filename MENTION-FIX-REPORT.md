# Исправления чата: mentions, Thread, unread и scheduled messages

## Единое правило mentions

Добавлен `apps/web/src/lib/mentions.ts`. Он используется parser/autocomplete, renderer, клиентским звуком mention, серверной отправкой, unread и `@everyone`. Серверный `serverMentions.ts` разрешает токены только в участников группы и не доверяет `mentions` из запроса.

## Изменённые файлы

- `apps/web/src/lib/mentions.ts`, `mentions.test.ts` — единый parser и regression-тесты.
- `apps/web/src/lib/serverMentions.ts` — серверное разрешение username в ID участников группы.
- `apps/web/src/components/connect/messageFormat.tsx`, `messageFormat.test.ts` — email/URL не подсвечиваются; неизвестные username остаются текстом.
- `apps/web/src/components/ui/MentionPopup.tsx` — те же границы токена и асинхронный поиск.
- `apps/web/src/components/connect/MessageArea.tsx` — общий parser, серверный autocomplete, реакции Thread в real-time, без клиентского массива mentions.
- `apps/web/src/components/connect/ThreadPanel.tsx` — autocomplete и корректный renderer mentions.
- `apps/web/src/components/connect/messageTypes.ts` — поле серверных mention IDs.
- `apps/web/src/app/api/messages/route.ts` — сервер вычисляет mentions на POST/PATCH, синхронизирует уведомления; GET Thread не меняет lastRead.
- `apps/web/src/app/api/channels/unread/route.ts` — stored IDs + единый parser вместо substring.
- `apps/web/src/app/api/groups/[id]/members/route.ts`, `apps/web/src/lib/groupMembersFetch.ts` — prefix search, максимум 20 результатов.
- `apps/web/src/lib/publishScheduledMessage.ts`, `apps/web/server.ts` — scheduled publication повторно проходит права, бан/timeout, лимит, sanitizer, censor, mentions и уведомления.

## Проверки

Команда:

`npm test -w apps/web -- --run src/lib/mentions.test.ts src/components/connect/messageFormat.test.ts src/components/ui/MentionPopup.test.ts`

Результат: 3 файла, 56 тестов — успешно.

`tsc --noEmit`: в изменённых файлах ошибок нет. Полная проверка репозитория по-прежнему сообщает 54 ранее существовавшие ошибки в других тестах/модулях (admin storage/censor tests, VoiceContext, appealNotify tests и др.).

## Дополнительно найдено

- Mention badge в NEWS/FEED зависел от наличия строк обычных каналов; условие убрано.
- GET сообщений одновременно читал данные и сбрасывал unread. Побочный эффект удалён; отметка прочтения остаётся в отдельном `/api/messages/read`.
- Scheduled messages при наступлении срока обходили актуальные права и moderation; теперь невалидная отложенная запись отклоняется и не ретраится бесконечно.
