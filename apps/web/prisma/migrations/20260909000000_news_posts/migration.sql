-- NEWSPOST: модуль «Новости» превращается из канала-переписки в ленту постов.
--
-- ── Почему пост не получил своей таблицы ────────────────────────────────────
--
-- Всё, из чего состоит пост, у сообщения уже есть: текст, вложения, реакции,
-- закрепление, отметка о правке и ветка обсуждения — она же комментарии.
-- Отдельная таблица означала бы вторую копию этого набора и второй комплект
-- кода вокруг него (загрузка файлов, удаление автором, права модерации), а
-- значит — починку в одном месте, которая не доезжает во второе.
--
-- Поэтому в Message добавляются необязательные поля. В обычной переписке они
-- остаются пустыми: ни один существующий запрос их не читает, и поведение
-- каналов TEXT не меняется.

-- Заголовок. Пусто — пост без заголовка, карточка покажет один текст.
ALTER TABLE "Message" ADD COLUMN "title" VARCHAR(200);

-- Обложка карточки. Хранится ПУТЬ внутри нашего хранилища (/uploads/...), а не
-- произвольный адрес: иначе лента стала бы способом подгрузить картинку с
-- чужого сервера и отдать ему адреса всех, кто открыл новость. Проверку делает
-- sanitizePostCover в lib/newsPost.ts — тот же класс защиты, что и
-- sanitizeReminderLink у напоминаний.
ALTER TABLE "Message" ADD COLUMN "cover" VARCHAR(400);

-- Просмотры. Число лежит рядом с постом намеренно: считать COUNT(*) по
-- PostView для каждой карточки — это по подзапросу на строку ленты, то есть
-- двадцать подзапросов на одну прокрутку.
ALTER TABLE "Message" ADD COLUMN "views" INTEGER NOT NULL DEFAULT 0;

-- Комментарии закрыты автором или модерацией.
ALTER TABLE "Message" ADD COLUMN "commentsClosed" BOOLEAN NOT NULL DEFAULT false;

-- Черновик виден только автору и никого не уведомляет.
ALTER TABLE "Message" ADD COLUMN "draft" BOOLEAN NOT NULL DEFAULT false;

-- Отложенная публикация: пока время не наступило, пост виден только автору.
ALTER TABLE "Message" ADD COLUMN "publishAt" TIMESTAMP(3);

-- Когда разослали уведомление о публикации.
--
-- Это не журнал, а защита: обход отложенных постов видит «время наступило» на
-- каждом тике, и без отметки он слал бы уведомление об одном и том же посте
-- каждые полминуты, пока пост существует.
ALTER TABLE "Message" ADD COLUMN "announcedAt" TIMESTAMP(3);

-- Лента: закреплённые первыми, дальше по убыванию даты. Существующий
-- (channelId, pinned) для сортировки внутри группы закреплённых не годится —
-- Postgres добирал бы дату сортировкой в памяти на каждой странице.
CREATE INDEX IF NOT EXISTS "Message_channelId_pinned_createdAt_idx"
    ON "Message"("channelId", "pinned", "createdAt");

-- Обход отложенных публикаций (см. setInterval в server.ts) ищет посты по
-- publishAt <= now AND announcedAt IS NULL. Без индекса это перебор всей
-- таблицы сообщений дважды в минуту — а Message самая большая таблица в базе.
CREATE INDEX IF NOT EXISTS "Message_publishAt_announcedAt_idx"
    ON "Message"("publishAt", "announcedAt");

-- Кто уже видел пост.
--
-- Одного счётчика на посте мало: без этих строк просмотры накручивались бы
-- обновлением страницы, и число под постом перестало бы что-либо значить.
-- Уникальность пары (пост, человек) закрывает и гонку двух вкладок — на уровне
-- базы, а не проверкой «нет ли уже» перед вставкой, которая в гонке как раз и
-- врёт.
CREATE TABLE "PostView" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PostView_messageId_userId_key" ON "PostView"("messageId", "userId");

-- Удаление аккаунта не должно спотыкаться о просмотры: чистим их вместе с
-- человеком. Отдельный индекс по userId нужен именно каскаду — без него
-- удаление пользователя перебирало бы всю таблицу просмотров.
CREATE INDEX "PostView_userId_idx" ON "PostView"("userId");

ALTER TABLE "PostView" ADD CONSTRAINT "PostView_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostView" ADD CONSTRAINT "PostView_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
