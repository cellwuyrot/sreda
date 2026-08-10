-- VPN-WG: пир WireGuard, привязанный к аккаунту.
--
-- Поля для приватного ключа здесь СОЗНАТЕЛЬНО НЕТ. Пара ключей создаётся на
-- устройстве владельца, приватная половина остаётся в защищённом хранилище ОС;
-- на сервер уходит только публичный ключ. Один аккаунт — один пир, поэтому
-- userId уникален: повторная регистрация заменяет ключ, а не добавляет второй.

CREATE TABLE IF NOT EXISTS "VpnPeer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastHandshakeAt" TIMESTAMP(3),
    "label" VARCHAR(80) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VpnPeer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VpnPeer_userId_key" ON "VpnPeer" ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "VpnPeer_publicKey_key" ON "VpnPeer" ("publicKey");
CREATE UNIQUE INDEX IF NOT EXISTS "VpnPeer_address_key" ON "VpnPeer" ("address");
CREATE INDEX IF NOT EXISTS "VpnPeer_nodeId_idx" ON "VpnPeer" ("nodeId");

DO $$
BEGIN
  ALTER TABLE "VpnPeer"
    ADD CONSTRAINT "VpnPeer_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "VpnPeer"
    ADD CONSTRAINT "VpnPeer_nodeId_fkey" FOREIGN KEY ("nodeId")
    REFERENCES "ServerNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
