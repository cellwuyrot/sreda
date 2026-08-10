-- STORAGE-PRIORITY: приоритет дочернего узла хранения над главным сервером.
--
-- До этого все вложения лежали на машине приложения: раздел «Серверы» вёл
-- реестр узлов, но место файла от него не зависело — узел хранения можно было
-- завести, и ничего не менялось. Теперь у файла появляется место, а у узла —
-- параметры хранилища, куда это место указывает.
--
-- Пустой nodeId означает «на главном сервере». Так работает и всё, что
-- загружено раньше: правило по умолчанию совпадает с прежним поведением, и
-- миграция ничего не переносит сама.
--
-- Секретный ключ хранилища кладётся зашифрованным (ENCRYPTION_SECRET), поэтому
-- поле текстовое, а не короткое.
--
-- Идемпотентно: миграция может доехать на базу, где её часть уже применена.

ALTER TABLE "ServerNode" ADD COLUMN IF NOT EXISTS "storageEndpoint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ServerNode" ADD COLUMN IF NOT EXISTS "storageBucket" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ServerNode" ADD COLUMN IF NOT EXISTS "storageRegion" TEXT NOT NULL DEFAULT 'us-east-1';
ALTER TABLE "ServerNode" ADD COLUMN IF NOT EXISTS "storageKeyId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ServerNode" ADD COLUMN IF NOT EXISTS "storageSecretEnc" TEXT NOT NULL DEFAULT '';

ALTER TABLE "UploadedFile" ADD COLUMN IF NOT EXISTS "nodeId" TEXT;
ALTER TABLE "UploadedFile" ADD COLUMN IF NOT EXISTS "size" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "UploadedFile_nodeId_idx" ON "UploadedFile"("nodeId");
