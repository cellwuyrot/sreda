-- WS-HISTORY: снимки состояния рабочей среды.
--
-- Отмена живёт только в текущей вкладке и исчезает вместе с ней, истории версий
-- не было вовсе, а холст можно потерять целиком — чужим сохранением или
-- собственной неосторожностью. Снимок — дешёвая страховка ровно там, где её не
-- было никакой.
--
-- Одна таблица на оба режима: ownerKey — это идентификатор человека для личной
-- среды и «channel:<id>» для общего холста. Две таблицы означали бы две
-- одинаковые реализации и два места, где можно забыть чистку старого.
--
-- Индекс по (ownerKey, createdAt): по нему идут оба запроса — «покажи историю»
-- и «что удалить сверх последних двадцати».
--
-- Идемпотентно: миграция может доехать на базу, где её часть уже применена.

CREATE TABLE IF NOT EXISTS "WorkspaceSnapshot" (
  "id" TEXT NOT NULL,
  "ownerKey" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "byUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkspaceSnapshot_ownerKey_createdAt_idx"
  ON "WorkspaceSnapshot"("ownerKey", "createdAt");
