-- MAIL-KIT: расширение исходящих писем, вложения, черновики, подписи,
-- шаблоны и аудит отправки.

ALTER TABLE "MailMessage"
    ADD COLUMN "fromName" TEXT,
    ADD COLUMN "ccAddr" TEXT,
    ADD COLUMN "bccAddr" TEXT,
    ADD COLUMN "attachmentsMeta" TEXT,
    ADD COLUMN "templateKey" TEXT,
    ADD COLUMN "sentById" TEXT,
    ADD COLUMN "sentByName" TEXT,
    ADD COLUMN "inReplyToMid" TEXT;

CREATE TABLE "MailAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "inline" BOOLEAN NOT NULL DEFAULT false,
    "contentB64" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MailAttachment_messageId_idx" ON "MailAttachment"("messageId");
ALTER TABLE "MailAttachment"
    ADD CONSTRAINT "MailAttachment_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "MailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MailTemplate" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'html',
    "body" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailTemplate_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "MailDraft" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "localPart" TEXT NOT NULL,
    "fromName" TEXT,
    "toAddr" TEXT,
    "ccAddr" TEXT,
    "bccAddr" TEXT,
    "subject" TEXT,
    "format" TEXT NOT NULL DEFAULT 'html',
    "body" TEXT,
    "attachmentsMeta" TEXT,
    "templateKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailDraft_authorId_localPart_key" ON "MailDraft"("authorId", "localPart");

CREATE TABLE "MailSignature" (
    "localPart" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailSignature_pkey" PRIMARY KEY ("localPart")
);

CREATE TABLE "MailSendLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "toAddr" TEXT NOT NULL,
    "ccAddr" TEXT,
    "bccAddr" TEXT,
    "subject" TEXT NOT NULL,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "templateKey" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailSendLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MailSendLog_createdAt_idx" ON "MailSendLog"("createdAt");
CREATE INDEX "MailSendLog_userId_idx" ON "MailSendLog"("userId");
