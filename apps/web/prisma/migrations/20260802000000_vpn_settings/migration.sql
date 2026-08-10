-- VPN-PANEL: настройки сервиса VPN одной записью (id = 'default').
--
-- enabled по умолчанию false: сервис не должен включаться сам собой при
-- обновлении — администратор включает его осознанно из панели.

CREATE TABLE IF NOT EXISTS "VpnSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dns" TEXT NOT NULL DEFAULT '1.1.1.1',
    "allowedIps" TEXT NOT NULL DEFAULT '0.0.0.0/0, ::/0',
    "maxPeersPerNode" INTEGER NOT NULL DEFAULT 200,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VpnSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "VpnSettings" ("id") VALUES ('default') ON CONFLICT ("id") DO NOTHING;
