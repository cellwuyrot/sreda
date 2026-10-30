ALTER TABLE "Message" ADD COLUMN "previewSuppressed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DirectMessage" ADD COLUMN "previewSuppressed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScheduledMessage" ADD COLUMN "previewSuppressed" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "ChatLinkPreviewHidden" (
 "userId" TEXT NOT NULL, "scope" VARCHAR(10) NOT NULL, "messageId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ChatLinkPreviewHidden_pkey" PRIMARY KEY ("userId", "scope", "messageId"),
 CONSTRAINT "ChatLinkPreviewHidden_scope_check" CHECK ("scope" IN ('channel', 'dm')),
 CONSTRAINT "ChatLinkPreviewHidden_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
