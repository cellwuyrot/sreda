-- Надёжный lifecycle почты: UID cursor, корзина, tombstones, read/delivery.
ALTER TABLE "ProjectMailbox"
  ADD COLUMN "lastSyncedUid" BIGINT,
  ADD COLUMN "imapUidValidity" BIGINT,
  ADD COLUMN "lastSyncAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncError" TEXT;

ALTER TABLE "MailMessage"
  ADD COLUMN "imapUid" BIGINT,
  ADD COLUMN "trashedAt" TIMESTAMP(3),
  ADD COLUMN "readAt" TIMESTAMP(3),
  ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN "deliveryError" TEXT,
  ADD COLUMN "deliveredAt" TIMESTAMP(3);

CREATE INDEX "MailMessage_mailboxId_trashedAt_sentAt_idx"
  ON "MailMessage"("mailboxId", "trashedAt", "sentAt");
CREATE INDEX "MailMessage_mailboxId_direction_readAt_idx"
  ON "MailMessage"("mailboxId", "direction", "readAt");

CREATE TABLE "MailDeletionTombstone" (
  "id" TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  "messageKey" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'deleted',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MailDeletionTombstone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailDeletionTombstone_mailboxId_messageKey_key"
  ON "MailDeletionTombstone"("mailboxId", "messageKey");
CREATE INDEX "MailDeletionTombstone_mailboxId_createdAt_idx"
  ON "MailDeletionTombstone"("mailboxId", "createdAt");
ALTER TABLE "MailDeletionTombstone"
  ADD CONSTRAINT "MailDeletionTombstone_mailboxId_fkey"
  FOREIGN KEY ("mailboxId") REFERENCES "ProjectMailbox"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;