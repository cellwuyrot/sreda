-- NETLINK-FRESH: свежесть учёта расхода и отметка изменения конфигурации туннеля.
--
-- usageUpdatedAt — когда узел последний раз присылал счётчики этого пира.
-- Пусто означает «учёта ещё не было»: это не то же самое, что «израсходовано 0».
--
-- configAt — когда менялась сама конфигурация (ключ, узел, адрес, маршруты).
-- До этого поля клиент сравнивал отчёт узла с `updatedAt`, а `updatedAt` растёт
-- и от записи счётчиков трафика — то есть от отчёта самого узла. Поэтому после
-- первого же учтённого трафика проверка «узел уже знает о моём ключе» не могла
-- стать истинной, и повторное включение туннеля упиралось в таймаут ожидания.
-- Существующим записям берём createdAt: их ключ узлу давно роздан.
ALTER TABLE "VpnPeer" ADD COLUMN IF NOT EXISTS "usageUpdatedAt" TIMESTAMP(3);
ALTER TABLE "VpnPeer" ADD COLUMN IF NOT EXISTS "configAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "VpnPeer" SET "configAt" = "createdAt" WHERE "configAt" > "createdAt";
