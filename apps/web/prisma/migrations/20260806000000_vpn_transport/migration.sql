-- VPN-TRANSPORT: тип подключения узла и параметры обфускации из отчёта агента.
ALTER TABLE "ServerNode" ADD COLUMN IF NOT EXISTS "transport" TEXT NOT NULL DEFAULT 'PLAIN';
ALTER TABLE "ServerNode" ADD COLUMN IF NOT EXISTS "obfuscation" TEXT NOT NULL DEFAULT '';
