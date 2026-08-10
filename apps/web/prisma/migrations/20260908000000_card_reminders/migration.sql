-- REMIND: напоминания на карточках рабочей среды.
--
-- Время напоминания хранится и в самой карточке (внутри JSON состояния среды),
-- но сработать оно там не может: этот JSON читают только при открытии холста.
-- Отдельная строка нужна ровно для того, чтобы сервер мог найти наступившие
-- сроки, ничего не разбирая, — отсюда индекс по (remindAt, firedAt).
--
-- Одна карточка — одно напоминание: повторная постановка заменяет прежнее,
-- поэтому пара (userId, cardId) уникальна.
CREATE TABLE "CardReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "link" VARCHAR(300) NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "firedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CardReminder_userId_cardId_key" ON "CardReminder"("userId", "cardId");

CREATE INDEX "CardReminder_remindAt_firedAt_idx" ON "CardReminder"("remindAt", "firedAt");

ALTER TABLE "CardReminder" ADD CONSTRAINT "CardReminder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
