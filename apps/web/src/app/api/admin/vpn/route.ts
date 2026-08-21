import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { VPN_SERVICE_ALLOWED_IPS, getVpnSettings, nodeTunnel } from "@/lib/vpn";
import { nodeStatus } from "@/lib/serverMesh";
import {
  MAX_THROTTLE_KBPS,
  MAX_TRAFFIC_LIMIT_GB,
  MAX_USAGE_PERIOD_DAYS,
  MIN_THROTTLE_KBPS,
  MIN_USAGE_PERIOD_DAYS,
  isOverLimitAction,
  periodExpired,
  usageView,
} from "@/lib/connectionUsage";

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

  /* NETLINK: расход трафика берётся из самих пиров, а не из отчёта узла:
     отчёт обнуляется при перезапуске интерфейса, а учёт по подписчикам живёт
     расчётными периодами. Цифра в панели обязана совпадать с тем, что видит
     человек у себя, иначе спор о расходе неразрешим. */
  const peers = await prisma.vpnPeer.findMany({
    select: {
      nodeId: true,
      enabled: true,
      rxBytes: true,
      txBytes: true,
      usageResetAt: true,
      lastHandshakeAt: true,
    },
  });

  const trafficByNode = new Map<string, number>();
  let usedTotal = 0;
  let overLimitCount = 0;
  let activeCount = 0;
  for (const peer of peers) {
    const view = usageView(peer, settings);
    usedTotal += view.usedBytes;
    if (view.overLimit) overLimitCount += 1;
    /* «Активен» — было рукопожатие за последние пять минут. Считать активным
       каждый выданный доступ было бы самообманом: большая часть туннелей
       стоит выключенной большую часть суток. */
    if (peer.lastHandshakeAt && Date.now() - peer.lastHandshakeAt.getTime() <= 5 * 60 * 1000) {
      activeCount += 1;
    }
    trafficByNode.set(peer.nodeId, (trafficByNode.get(peer.nodeId) ?? 0) + view.usedBytes);
  }

  return NextResponse.json({
    settings: {
      enabled: settings.enabled,
      dns: settings.dns,
      allowedIps: settings.allowedIps,
      serviceAllowedIps: settings.serviceAllowedIps,
      maxPeersPerNode: settings.maxPeersPerNode,
      // NETLINK: условия тарифа — одни и те же для Premium и отдельной подписки.
      trafficLimitGb: settings.trafficLimitGb,
      usagePeriodDays: settings.usagePeriodDays,
      overLimitAction: settings.overLimitAction,
      throttleKbps: settings.throttleKbps,
    },
    /* NETLINK: сводка по расходу. Считается здесь же, где считается лимит:
       две реализации одной арифметики расходятся в первый же месяц. */
    summary: {
      subscribers: peers.length,
      enabledPeers: peers.filter((peer) => peer.enabled).length,
      activePeers: activeCount,
      usedBytes: usedTotal,
      overLimitPeers: overLimitCount,
      /* Сколько всего полагается по всем выданным доступам — потолок трафика,
         который сервис обязан выдержать в худшем случае. */
      committedGb: settings.trafficLimitGb * peers.length,
      periodResets: peers.filter((peer) => periodExpired(peer.usageResetAt, settings.usagePeriodDays)).length,
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
        /* FIX-NOAWG: предупреждать больше не о чем — всем выдаётся обычное
           подключение независимо от пометок в базе. Поле оставлено в ответе,
           чтобы старая верстка панели не сломалась на его отсутствии. */
        obfuscationMissing: false,
        peers,
        capacity: settings.maxPeersPerNode,
        /* NETLINK: загруженность узла двумя цифрами: сколько устройств от потолка
           и сколько трафика он прокачал за текущие периоды своих подписчиков.
           Одно без другого вводит в заблуждение: десять устройств могут грузить
           сервер сильнее, чем сотня спящих. */
        load: settings.maxPeersPerNode > 0
          ? Math.min(100, Math.round((peers / settings.maxPeersPerNode) * 100))
          : 0,
        trafficBytes: trafficByNode.get(node.id) ?? 0,
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
        trafficLimitGb?: unknown;
        usagePeriodDays?: unknown;
        overLimitAction?: unknown;
        throttleKbps?: unknown;
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
  /* NETLINK: лимит трафика на подписчика. 0 — без ограничения: это осмысленный
     вариант, а не ошибка ввода, поэтому он разрешён явно. */
  if (body?.trafficLimitGb !== undefined) {
    const value = Math.trunc(Number(body.trafficLimitGb));
    if (!Number.isFinite(value) || value < 0 || value > MAX_TRAFFIC_LIMIT_GB) {
      return NextResponse.json(
        { error: `Лимит трафика: от 0 до ${MAX_TRAFFIC_LIMIT_GB} ГБ (0 — без ограничения)` },
        { status: 400 },
      );
    }
    data.trafficLimitGb = value;
  }
  if (body?.usagePeriodDays !== undefined) {
    const value = Math.trunc(Number(body.usagePeriodDays));
    if (!Number.isFinite(value) || value < MIN_USAGE_PERIOD_DAYS || value > MAX_USAGE_PERIOD_DAYS) {
      return NextResponse.json(
        { error: `Расчётный период: от ${MIN_USAGE_PERIOD_DAYS} до ${MAX_USAGE_PERIOD_DAYS} дней` },
        { status: 400 },
      );
    }
    data.usagePeriodDays = value;
  }
  if (body?.overLimitAction !== undefined) {
    if (!isOverLimitAction(body.overLimitAction)) {
      return NextResponse.json({ error: "Неизвестное правило при исчерпании лимита" }, { status: 400 });
    }
    data.overLimitAction = body.overLimitAction;
  }
  if (body?.throttleKbps !== undefined) {
    const value = Math.trunc(Number(body.throttleKbps));
    if (!Number.isFinite(value) || value < MIN_THROTTLE_KBPS || value > MAX_THROTTLE_KBPS) {
      return NextResponse.json(
        { error: `Скорость после лимита: от ${MIN_THROTTLE_KBPS} до ${MAX_THROTTLE_KBPS} Кбит/с` },
        { status: 400 },
      );
    }
    data.throttleKbps = value;
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
      trafficLimitGb: settings.trafficLimitGb,
      usagePeriodDays: settings.usagePeriodDays,
      overLimitAction: settings.overLimitAction,
      throttleKbps: settings.throttleKbps,
    },
  });
}
