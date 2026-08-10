-- BUILDS: очередь сборок клиентских приложений на сервере.
--
-- До этого APK и установщик Windows собирались руками на своём ПК и заливались
-- на сервер. Здесь появляется очередь: задачу ставит администратор в панели,
-- агент сборки её забирает и кладёт готовые файлы в то же хранилище загрузок.
-- Путь скачивания не меняется — меняется только то, кто эти файлы делает.
--
-- Индексы по статусу и времени: агент спрашивает «есть ли работа» раз в
-- несколько секунд, и этот запрос не должен читать всю таблицу.
--
-- Идемпотентно: миграция может доехать на базу, где её часть уже применена.

CREATE TABLE IF NOT EXISTS "BuildJob" (
  "id" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "ref" TEXT NOT NULL DEFAULT 'main',
  "version" TEXT NOT NULL DEFAULT '',
  "requestedById" TEXT,
  "nodeId" TEXT,
  "log" TEXT NOT NULL DEFAULT '',
  "artifacts" TEXT NOT NULL DEFAULT '',
  "error" VARCHAR(300) NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "BuildJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BuildJob_status_idx" ON "BuildJob"("status");
CREATE INDEX IF NOT EXISTS "BuildJob_createdAt_idx" ON "BuildJob"("createdAt");
