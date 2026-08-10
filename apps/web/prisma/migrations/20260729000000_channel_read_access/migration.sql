-- FIX-NEWSACL: право на чтение канала (новости и прочие каналы сообщества).
-- ALL — все участники (прежнее поведение), MOD — модераторы и выше,
-- ADMIN — владелец и администраторы. Дополняет postAccess (право публикации).
ALTER TABLE "Channel" ADD COLUMN     "readAccess" TEXT NOT NULL DEFAULT 'ALL';
