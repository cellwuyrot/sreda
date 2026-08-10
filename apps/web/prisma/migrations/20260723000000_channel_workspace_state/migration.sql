-- GROUP-WORKSPACE: совместная «Рабочая среда» группы (модуль CANVAS).
-- Одна запись на канал-модуль; внутри JSON StoredState с холстами (до 5).

CREATE TABLE "ChannelWorkspaceState" (
    "channelId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelWorkspaceState_pkey" PRIMARY KEY ("channelId")
);

ALTER TABLE "ChannelWorkspaceState"
  ADD CONSTRAINT "ChannelWorkspaceState_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
