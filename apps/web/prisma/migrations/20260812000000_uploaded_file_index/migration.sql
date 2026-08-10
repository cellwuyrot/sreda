-- Указатель «файл → чему он принадлежит».
--
-- Без него от адреса вложения нельзя дойти до канала или беседы: вложения
-- сообщений лежат в JSON-поле. Из-за этого выдача файла умела проверять только
-- «человек вошёл», но не «человеку сюда можно».
--
-- Строки для уже загруженных файлов создаёт разовый разбор истории
-- (apps/web/scripts/backfill-upload-index.mjs, см. docs/server-actions.md).

CREATE TABLE IF NOT EXISTS "UploadedFile" (
    "id"             TEXT NOT NULL,
    "path"           TEXT NOT NULL,
    "dir"            TEXT NOT NULL,
    "uploaderId"     TEXT NOT NULL,
    "channelId"      TEXT,
    "conversationId" TEXT,
    "taskId"         TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UploadedFile_path_key" ON "UploadedFile"("path");
CREATE INDEX IF NOT EXISTS "UploadedFile_channelId_idx" ON "UploadedFile"("channelId");
CREATE INDEX IF NOT EXISTS "UploadedFile_conversationId_idx" ON "UploadedFile"("conversationId");
CREATE INDEX IF NOT EXISTS "UploadedFile_taskId_idx" ON "UploadedFile"("taskId");
