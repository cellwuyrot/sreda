-- PROJECT-MAIL: реестр почтовых ящиков домена и история писем по каждому.
-- Ящики домена создаются на хостинге руками; здесь их метаданные и последние
-- письма (входящие/исходящие) для листинга в админ-панели.

CREATE TABLE "ProjectMailbox" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "localPart" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectMailbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectMailbox_address_key" ON "ProjectMailbox"("address");
CREATE UNIQUE INDEX "ProjectMailbox_localPart_key" ON "ProjectMailbox"("localPart");
CREATE INDEX "ProjectMailbox_order_idx" ON "ProjectMailbox"("order");

CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "fromAddr" TEXT NOT NULL,
    "toAddr" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "messageId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailMessage_messageId_key" ON "MailMessage"("messageId");
CREATE INDEX "MailMessage_mailboxId_archived_sentAt_idx" ON "MailMessage"("mailboxId", "archived", "sentAt");
CREATE INDEX "MailMessage_mailboxId_direction_archived_sentAt_idx" ON "MailMessage"("mailboxId", "direction", "archived", "sentAt");

ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "ProjectMailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
