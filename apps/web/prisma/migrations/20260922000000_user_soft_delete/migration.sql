-- FIX-KEEP-CONTENT: удаление аккаунта больше не стирает строку пользователя.
--
-- Раньше /api/profile/delete звал prisma.user.delete(), и каскад (onDelete:
-- Cascade на Message, Poll, ChannelTask, WikiArticle, QAThread и остальных)
-- уносил вместе с человеком ВСЁ, что он создал в сообществах: чаты, новости,
-- задачи, статьи. Материал сообщества не должен зависеть от того, остался ли в
-- нём автор, поэтому запись теперь обезличивается, а не удаляется: имя
-- становится «Удалённый пользователь», вход закрывается по признаку isDeleted.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
