-- MAIL-HISTORY: дедупликация писем в пределах ящика, а не всей таблицы.
--
-- Глобальный уникальный индекс по Message-ID терял письма: письмо,
-- адресованное двум ящикам домена (To: info@, Cc: sales@), сохранялось только
-- в один из них — во втором его в истории не было никогда.
--
-- Порядок шагов важен. Сначала снимаем старый индекс: пока он на месте,
-- заполнение ключей падает на первом же дубле. Потом проставляем ключ письмам
-- без Message-ID (для них дедуп не работал вовсе, поэтому именно среди них и
-- накопились копии), убираем копии внутри ящика и только затем ставим новую
-- уникальность.

-- 1. Старая область уникальности — на всю таблицу.
DROP INDEX IF EXISTS "MailMessage_messageId_key";

-- 2. Письмам без ключа дедупликации проставляем синтетический ключ по
--    содержимому — тот же принцип, что в lib/projectMail.syntheticMessageId
--    (ящик, отправитель, тема, дата, тело).
--    Разделитель — 0x01: NUL (0x00) в тексте Postgres не хранится, а склеивать
--    поля без разделителя нельзя (иначе «ab»+«c» и «a»+«bc» дают один ключ).
UPDATE "MailMessage" m
SET "messageId" = 'synthetic:sql:' || md5(
    m."mailboxId" || E'\x01' || m."fromAddr" || E'\x01' || m."subject" ||
    E'\x01' || to_char(m."sentAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS') || E'\x01' || m."bodyText"
)
WHERE m."messageId" IS NULL;

-- 3. Удаляем дубли в пределах ящика, оставляя самую раннюю запись.
DELETE FROM "MailMessage" m
USING "MailMessage" keep
WHERE m."mailboxId" = keep."mailboxId"
  AND m."messageId" = keep."messageId"
  AND (keep."createdAt", keep."id") < (m."createdAt", m."id");

-- 4. Новая область уникальности — ящик + ключ письма.
CREATE UNIQUE INDEX "MailMessage_mailboxId_messageId_key" ON "MailMessage"("mailboxId", "messageId");
