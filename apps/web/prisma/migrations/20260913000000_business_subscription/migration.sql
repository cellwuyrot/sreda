-- BUSINESS-SUB: альтернативный счёт бизнеса — по системе подписки.
--
-- Миграция только добавляет колонки с значениями по умолчанию, поэтому
-- уже выставленные счета остаются разовыми (ONE_TIME) и не меняют поведения.
-- Простоя не требует.

ALTER TABLE "BusinessPayment" ADD COLUMN "mode" VARCHAR(16) NOT NULL DEFAULT 'ONE_TIME';
ALTER TABLE "BusinessPayment" ADD COLUMN "period" VARCHAR(16);
ALTER TABLE "BusinessPayment" ADD COLUMN "cycles" INTEGER;
ALTER TABLE "BusinessPayment" ADD COLUMN "paidCycles" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BusinessPayment" ADD COLUMN "nextDueAt" TIMESTAMP(3);

-- Уже оплаченным счетам ставим paidCycles = 1: иначе счётчик показывал бы
-- «оплачено периодов: 0» на оплаченном счёте — ровно то место, где человек
-- перестаёт верить цифрам на экране.
UPDATE "BusinessPayment" SET "paidCycles" = 1 WHERE "status" = 'PAID';

-- Выборка «кому пора платить» идёт по сроку среди подписок.
CREATE INDEX "BusinessPayment_mode_nextDueAt_idx" ON "BusinessPayment"("mode", "nextDueAt");
