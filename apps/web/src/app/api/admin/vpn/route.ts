import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { VPN_SERVICE_ALLOWED_IPS, getVpnSettings, nodeTunnel } from "@/lib/vpn";
import { nodeStatus } from "@/lib/serverMesh";

// VPN-PANEL: управление сервисом VPN. Только ADMIN — редактор сюда не
// допускается: речь об инфраструктуре и доступах, а не о контенте.

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session.user;
}

const MIN_PEERS = 1;
const MAX_PEERS = 253; // потолок одной /24 за вычетом адреса самого сервера

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await getVpnSettings();

  const nodes = await prisma.serverNode.findMany({
    where: { kind: "VPN" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      region: true,
      enabled: true,
      endpointHost: true,
      transport: true,
      obfuscation: true,
      lastReport: true,
      lastSeenAt: true,
      _count: { select: { vpnPeers: true } },
    },
  });

  return NextResponse.json({
    settings: {
      enabled: settings.enabled,
      dns: settings.dns,
      allowedIps: settings.allowedIps,
      serviceAllowedIps: settings.serviceAllowedIps,
      maxPeersPerNode: settings.maxPeersPerNode,
    },
    /* VPN-PANEL2: состояние узла считается здесь, а не в панели. Сервер и так
       знает и отчёт, и точку подключения, и потолок; собирать это заново на
       клиенте означало бы держать те же правила в двух местах. */
    nodes: nodes.map((node) => {
      const wg = nodeTunnel(node);
      const peers = node._count.vpnPeers;
      const online = nodeStatus(node.lastSeenAt, node.enabled) === "online";
      const state = !node.enabled
        ? "DISABLED"
        : !online
          ? "NO_REPORT"
          : !wg.publicKey
            ? "NO_KEY"
            : !wg.endpoint
              ? "NO_ENDPOINT"
              : peers >= settings.maxPeersPerNode
                ? "FULL"
                : "READY";
      return {
        id: node.id,
        name: node.name,
        region: node.region,
        endpoint: wg.endpoint,
        transport: node.transport,
        /* Узел объявлен устойчивым, но параметров ещё не прислал — профиль
           соберётся без них, то есть как обычный. Это стоит показать. */
        obfuscationMissing: node.transport === "OBFUSCATED" && !wg.obfuscation,
        peers,
        capacity: settings.maxPeersPerNode,
        lastSeenAt: node.lastSeenAt,
        state,
      };
    }),
  });
}

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | {
        enabled?: unknown;
        dns?: unknown;
        allowedIps?: unknown;
        serviceAllowedIps?: unknown;
        maxPeersPerNode?: unknown;
      }
    | null;

  const data: Record<string, unknown> = {};
  if (typeof body?.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body?.dns === "string") {
    const dns = body.dns.trim().slice(0, 100);
    // Список адресов через запятую — проверяем каждый как IPv4/IPv6-подобный.
    if (dns && !/^[0-9a-fA-F:., ]+$/.test(dns)) {
      return NextResponse.json({ error: "DNS должен быть списком IP-адресов через запятую" }, { status: 400 });
    }
    data.dns = dns || "1.1.1.1";
  }
  if (typeof body?.allowedIps === "string") {
    const allowed = body.allowedIps.trim().slice(0, 200);
    if (allowed && !/^[0-9a-fA-F:.,/ ]+$/.test(allowed)) {
      return NextResponse.json({ error: "Маршруты должны быть списком подсетей через запятую" }, { status: 400 });
    }
    data.allowedIps = allowed || "0.0.0.0/0, ::/0";
  }
  /* VPN-ROUTING: маршруты второго варианта выбора — «только сервисы TZ». Здесь
     администратор перечисляет адреса самого проекта; какой из двух вариантов
     применить, решает человек при включении VPN. */
  if (typeof body?.serviceAllowedIps === "string") {
    const service = body.serviceAllowedIps.trim().slice(0, 200);
    if (service && !/^[0-9a-fA-F:.,/ ]+$/.test(service)) {
      return NextResponse.json({ error: "Маршруты должны быть списком подсетей через запятую" }, { status: 400 });
    }
    data.serviceAllowedIps = service || VPN_SERVICE_ALLOWED_IPS;
  }
  if (body?.maxPeersPerNode !== undefined) {
    const value = Math.trunc(Number(body.maxPeersPerNode));
    if (!Number.isFinite(value) || value < MIN_PEERS || value > MAX_PEERS) {
      return NextResponse.json({ error: `Потолок пиров: от ${MIN_PEERS} до ${MAX_PEERS}` }, { status: 400 });
    }
    data.maxPeersPerNode = value;
  }

  const settings = await prisma.vpnSettings.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });

  return NextResponse.json({
    settings: {
      enabled: settings.enabled,
      dns: settings.dns,
      allowedIps: settings.allowedIps,
      serviceAllowedIps: settings.serviceAllowedIps,
      maxPeersPerNode: settings.maxPeersPerNode,
    },
  });
}
