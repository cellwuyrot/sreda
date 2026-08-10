-- VPN-ENDPOINT: точка подключения WireGuard, задаваемая в панели.
--
-- До этого адрес узла для клиентов существовал только как переменная окружения
-- `WG_ENDPOINT_HOST` на самом узле, а в панели было поле «Адрес» под http(s) —
-- для WireGuard бессмысленное. Узел за NAT своего публичного адреса не знает,
-- поэтому источником истины должна быть панель.
ALTER TABLE "ServerNode" ADD COLUMN IF NOT EXISTS "endpointHost" TEXT NOT NULL DEFAULT '';
