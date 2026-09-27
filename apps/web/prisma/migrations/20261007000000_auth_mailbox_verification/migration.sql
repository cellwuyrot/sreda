-- AUTH-MAIL: коды подтверждения отправляются через внутренний noreply@trioz.ru
-- и связываются с записью исходящего письма для отслеживания в админ-панели.

ALTER TABLE "VerificationCode"
    ADD COLUMN "sendStatus" TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN "sendError" TEXT;

-- Все существующие записи появились до нового delivery lifecycle. Исторически
-- неотправленные записи удалялись при ошибке SMTP, поэтому оставшиеся считаем
-- успешно отправленными. Новые записи останутся pending до подтверждения SMTP.
UPDATE "VerificationCode"
SET "sendStatus" = 'sent'
WHERE "sendStatus" = 'pending';

CREATE INDEX "VerificationCode_email_sendStatus_createdAt_idx"
    ON "VerificationCode"("email", "sendStatus", "createdAt");

ALTER TABLE "MailMessage"
    ADD COLUMN "verificationCodeId" TEXT;

CREATE UNIQUE INDEX "MailMessage_verificationCodeId_key"
    ON "MailMessage"("verificationCodeId");

ALTER TABLE "MailMessage"
    ADD CONSTRAINT "MailMessage_verificationCodeId_fkey"
    FOREIGN KEY ("verificationCodeId") REFERENCES "VerificationCode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
