-- Add sequential per-channel task numbers and closing metadata
ALTER TABLE "ChannelTask" ADD COLUMN "number" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChannelTask" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "ChannelTask" ADD COLUMN "closedById" TEXT;

-- Backfill numbers per channel ordered by creation date (from 1)
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "channelId" ORDER BY "createdAt" ASC) AS rn
  FROM "ChannelTask"
)
UPDATE "ChannelTask" t
SET "number" = numbered.rn
FROM numbered
WHERE t."id" = numbered."id";

-- Mark already-done tasks as closed
UPDATE "ChannelTask" SET "closedAt" = "updatedAt" WHERE "status" = 'done' AND "closedAt" IS NULL;

CREATE UNIQUE INDEX "ChannelTask_channelId_number_key" ON "ChannelTask"("channelId", "number");

ALTER TABLE "ChannelTask"
ADD CONSTRAINT "ChannelTask_closedById_fkey"
FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
