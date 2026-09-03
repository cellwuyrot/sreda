import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { checkBan } from "@/lib/banCheck";
import {
  VPN_SERVER_ADDRESS,
  assignExitIp,
  chooseAddress,
  getVpnSettings,
  hasVpnEntitlement,
  isValidWireGuardKey,
  isVpnRouting,
  nodeTunnel,
  pickVpnNode,
  routingAllowedIps,
  allocateAddress,
} from "@/lib/vpn";
import { NODE_ONLINE_WINDOW_MS } from "@/lib/serverMesh";
import { hasPremium } from "@/lib/premium";
import { hasActiveVpnPlan } from "@/lib/vpnPlan";
import { usageView } from "@/lib/connectionUsage";
import { LINK_NAME_LOWER, LINK_PLAN_NAME, LINK_PLAN_QUOTED } from "@/lib/connectionCopy";

/**
 * VPN-WG: собственный доступ пользователя.
 *
 *  GET    — что за пир привязан к аккаунту и на каком узле.
 *  POST   — зарегистрировать ПУБЛИЧНЫЙ ключ, созданный на устройстве.
 *  DELETE — отозвать доступ.
 *
 * Приватный ключ сюда не приходит и приниматься не должен: если в теле запроса
 * окажется что-то похожее на приватный ключ, запрос отклоняется — так ошибка в
 * клиенте не превратится в утечку секрета на сервер.
 *
 * VPN-AUTOPREMIUM: право на доступ определяется признаком Premium, а не
 * действием администратора. Раньше выдача шла через ввод логина в панели — то
 * есть человек вручную повторял то, что система и так знает. Теперь клиент
 * сам создаёт ключ и регистрирует его, а сервер лишь проверяет право.
 */

/** Что отдаём наружу. Ничего секретного здесь нет: только публичные данные. */
function peerView(
  peer: {
    publicKey: string;
    address: string;
    exitIp: string;
    enabled: boolean;
    label: string;
    routing: string;
    lastHandshakeAt: Date | null;
    createdAt: Date;
  },
  node: { name: string; region: string } | null,
  wg: { publicKey: string | null; endpoint: string | null; obfuscation?: Record<string, string | number> | null },
  settings: { dns: string; allowedIps: string; serviceAllowedIps?: string | null },
) {
  return {
    publicKey: peer.publicKey,
    /** Адрес внутри туннеля: 10.8.0.X. Именно он идёт в Address конфига. */
    address: peer.address,
    /** Внешний адрес выхода — то, что видят сайты. Пусто = общий адрес узла. */
    exitIp: peer.exitIp,
    enabled: peer.enabled,
    label: peer.label,
    /* VPN-ROUTING: что человек выбрал при выдаче. Панель без этого не смогла бы
       даже сказать, в каком режиме выдан доступ: профиль показан один раз. */
    routing: peer.routing,
    lastHandshakeAt: peer.lastHandshakeAt,
    createdAt: peer.createdAt,
    node: node ? { name: node.name, region: node.region } : null,
    // Данные для сборки конфигурации на устройстве. Приватный ключ клиент
    // подставляет сам из хранилища ОС — по сети он не передаётся никогда.
    tunnel: {
      serverPublicKey: wg.publicKey,
      endpoint: wg.endpoint,
      /* Маршруты берутся по режиму пира, а не одни на всех: это и есть выбор
         «весь трафик» либо «только сервисы TZ». */
      allowedIps: routingAllowedIps(settings, peer.routing),
      dns: settings.dns,
      serverAddress: VPN_SERVER_ADDRESS,
      /* Дополнительные параметры интерфейса, если узел их требует. Для клиента
         это просто набор строк в профиль: тип подключения ему не сообщается и
         в интерфейсе нигде не показывается. */
      extra: wg.obfuscation ?? null,
    },
  };
}

/**
 * NETLINK: по какому основанию человеку дано соединение и до какого числа.
 *
 * Оснований два — Premium и отдельная подписка, — а условия у них одинаковые.
 * Клиенту нужно не право как флаг, а строка на экран: иначе ему пришлось бы
 * самому складывать название тарифа из двух признаков и двух дат.
 */
function planView(
  user: {
    isPremium: boolean;
    role: string;
    vpnAccess: boolean | null;
    vpnAccessUntil: Date | null;
  },
  /* Срок Premium хранится не на пользователе, а в подписке: на пользователе
     только флаг. `null` — бессрочно или Premium по роли. */
  premiumUntil: Date | null,
) {
  if (hasPremium(user)) {
    return {
      kind: "premium" as const,
      label: "Premium",
      note: `Соединение входит в Premium — подписка ${LINK_PLAN_QUOTED} отдельно не нужна.`,
      until: premiumUntil ? premiumUntil.toISOString() : null,
    };
  }
  if (hasActiveVpnPlan(user)) {
    return {
      kind: "link" as const,
      label: LINK_PLAN_NAME,
      note: "Условия по соединению те же, что и в Premium.",
      until: user.vpnAccessUntil ? user.vpnAccessUntil.toISOString() : null,
    };
  }
  return {
    kind: "none" as const,
    label: "Нет подписки",
    note: `Доступ к ${LINK_NAME_LOWER} даёт Premium или подписка ${LINK_PLAN_QUOTED}.`,
    until: null,
  };
}

/**
 * NETLINK: серверы, куда человек действительно может сесть.
 *
 * Заполненные узлы остаются в списке с пометкой `full`, а не исчезают: исчезнувший
 * вариант выглядит как ошибка, а видимый и погашенный — как ответ. Свой текущий
 * узел показывается всегда, даже если он уже не принимает новых, — иначе человек не
 * видел бы, где находится.
 */
async function serverChoices(maxPeersPerNode: number, currentNodeId: string | null) {
  const limit = maxPeersPerNode > 0 ? maxPeersPerNode : 1;
  const nodes = await prisma.serverNode.findMany({
    where: { kind: "VPN", enabled: true },
    select: {
      id: true,
      name: true,
      region: true,
      lastReport: true,
      lastSeenAt: true,
      endpointHost: true,
      transport: true,
      obfuscation: true,
      _count: { select: { vpnPeers: true } },
    },
    orderBy: { name: "asc" },
  });

  const now = Date.now();
  return nodes
    .map((node) => {
      const wg = nodeTunnel(node);
      const online = !!node.lastSeenAt && now - node.lastSeenAt.getTime() < NODE_ONLINE_WINDOW_MS;
      const peers = node._count.vpnPeers;
      const current = node.id === currentNodeId;
      return {
        id: node.id,
        name: node.name,
        region: node.region ?? "",
        /* Загруженность — доля от потолка устройств, то же число, что видит администратор. */
        load: Math.min(100, Math.round((peers / limit) * 100)),
        full: peers >= limit,
        ready: online && !!wg.publicKey && !!wg.endpoint,
        current,
      };
    })
    .filter((node) => node.ready || node.current);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getVpnSettings();
  const entitled = await hasVpnEntitlement(session.user.id);
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isPremium: true, role: true, vpnAccess: true, vpnAccessUntil: true },
  });

  /* Срок Premium — по действующей подписке с самой поздней датой окончания.
     Бессрочная запись (`expiresAt = null`) должна побеждать любую срочную, поэтому
     сначала смотрим, есть ли она вообще, и только потом берём максимум даты:
     иначе у бессрочного Premium кнопка показывала бы старую разовую дату. */
  let premiumUntil: Date | null = null;
  if (user?.isPremium) {
    const lifetime = await prisma.premiumSubscription.findFirst({
      where: { userId: session.user.id, status: "active", expiresAt: null },
      select: { id: true },
    });
    if (!lifetime) {
      const latest = await prisma.premiumSubscription.findFirst({
        where: { userId: session.user.id, status: "active" },
        orderBy: { expiresAt: "desc" },
        select: { expiresAt: true },
      });
      premiumUntil = latest?.expiresAt ?? null;
    }
  }
  const peer = await prisma.vpnPeer.findUnique({
    where: { userId: session.user.id },
    include: {
      node: {
        /* FIX-PEERWAIT: `lastSeenAt` нужен, чтобы ответить на вопрос «узел уже
           знает об этом пире?». Без ответа клиент поднимал туннель в пустоту. */
        select: {
          name: true,
          region: true,
          lastReport: true,
          lastSeenAt: true,
          endpointHost: true,
          transport: true,
          obfuscation: true,
        },
      },
    },
  });

  // Признак «узел готов принимать пиров» нужен клиенту заранее: если ни один
  // узел ещё не отчитался, автоматическая выдача просто не сработает, и честнее
  // сказать это до нажатия кнопки, а не после.
  const nodeReady = settings.enabled ? !!(await pickVpnNode(settings.maxPeersPerNode)) : false;

  /* NETLINK: тариф, расход и серверы отдаются ВСЕГДА, а не только когда есть пир.
     Кнопка у клиента показывает срок и лимит до первого включения тоже: именно тогда
     человек и решает, нужна ли ему подписка. Отсутствующие поля вместо нулей заставляют
     клиент угадывать, а угадывать он не умеет. */
  // FIX-ADMIN-UNLIMITED: администраторы проекта (user.role === "ADMIN") получают
  // безлимитный VPN. Это отдельный уровень от администраторов групп/сообществ.
  const isProjectAdmin = user?.role === "ADMIN";
  const effectiveSettings = isProjectAdmin
    ? { ...settings, trafficLimitGb: 0 }
    : settings;
  const traffic = {
    ...usageView(peer, effectiveSettings),
    limitGb: effectiveSettings.trafficLimitGb,
    overLimitAction: settings.overLimitAction,
    throttleKbps: settings.throttleKbps,
  };

  const servers = await serverChoices(settings.maxPeersPerNode, peer?.nodeId ?? null);

  const plan = planView(
    user ?? { isPremium: false, role: "USER", vpnAccess: null, vpnAccessUntil: null },
    premiumUntil,
  );

  if (!peer) {
    return NextResponse.json({
      peer: null,
      serviceEnabled: settings.enabled,
      entitled,
      nodeReady,
      plan,
      traffic,
      servers,
    });
  }

  /* FIX-PEERWAIT: узнал ли УЗЕЛ об этом пире, а не только база сайта.

     Узел работает «на вытягивание»: он получает список пиров в ответе на свой
     отчёт и тут же приводит интерфейс к нему. Значит отчёт, пришедший ПОЗЖЕ
     последнего изменения записи, означает, что пир на узле уже стоит. Обратное
     сравнение — отчёт старше записи — означает, что ключ ещё едет, и включать
     туннель рано: WireGuard на неизвестный ключ молчит, и клиент отправит
     рукопожатия в пустоту (см. FIX-PEERWAIT в api/servers/report/route.ts).

     Отдельного поля «применено» здесь нет намеренно: `lastSeenAt` обновляется
     тем же запросом, который отдаёт узлу пиров, поэтому оно уже является этой
     отметкой. Лишний столбец пришлось бы поддерживать в согласии с ним. */
  const peerApplied =
    !!peer.node.lastSeenAt && peer.node.lastSeenAt.getTime() > peer.updatedAt.getTime();

  return NextResponse.json({
    serviceEnabled: settings.enabled,
    entitled,
    nodeReady,
    plan,
    traffic,
    servers,
    /** Узел уже знает об этом пире — туннель можно поднимать. */
    peerApplied,
    peer: { ...peerView(peer, peer.node, nodeTunnel(peer.node), settings), nodeId: peer.nodeId },
  });
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "vpn-enroll", { limit: 10, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /* Забаненному доступ не выдаём. Сессия при бане живёт до обновления, поэтому
     на самом действии проверка нужна отдельно — как и во всех остальных
     маршрутах, которые что-то создают. */
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  // VPN-PANEL: сервис выключен администратором — новые пиры не регистрируем.
  // Существующие при этом уже отпали: узлам уходит пустой список (см. отчёт).
  const settings = await getVpnSettings();
  if (!settings.enabled) {
    return NextResponse.json({ error: "Сервис отключён администратором" }, { status: 503 });
  }

  // VPN-AUTOPREMIUM / VPN-PLAN: условие выдачи — Premium или подписка только на VPN.
  if (!(await hasVpnEntitlement(session.user.id))) {
    return NextResponse.json(
      { error: `Соединение доступно по подписке ${LINK_PLAN_QUOTED} или по Premium` },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { publicKey?: unknown; privateKey?: unknown; label?: unknown; routing?: unknown }
    | null;

  // Страховка от ошибки в клиенте: приватный ключ на сервере не нужен и не
  // принимается ни под каким видом.
  if (body?.privateKey !== undefined) {
    return NextResponse.json(
      { error: "Приватный ключ не передаётся на сервер. Отправляйте только публичный." },
      { status: 400 },
    );
  }

  if (!isValidWireGuardKey(body?.publicKey)) {
    return NextResponse.json({ error: "Некорректный публичный ключ WireGuard" }, { status: 400 });
  }
  const publicKey = body.publicKey;

  /* VPN-ROUTING: режим приходит от клиента, потому что выбирает его человек.
     Значение проверяется, а не подставляется молча: неизвестный режим — это
     ошибка в клиенте, и тихо выдать «весь трафик» вместо выбранного «только
     сервисы TZ» значило бы отправить трафик не туда, куда просили. */
  if (body.routing !== undefined && !isVpnRouting(body.routing)) {
    return NextResponse.json({ error: "Неизвестный режим маршрутизации" }, { status: 400 });
  }

  // Один и тот же ключ не может принадлежать двум аккаунтам.
  const keyOwner = await prisma.vpnPeer.findUnique({ where: { publicKey }, select: { userId: true } });
  if (keyOwner && keyOwner.userId !== session.user.id) {
    return NextResponse.json({ error: "Этот ключ уже занят другим аккаунтом" }, { status: 409 });
  }

  const existing = await prisma.vpnPeer.findUnique({
    where: { userId: session.user.id },
    include: {
      node: {
        select: {
          id: true, name: true, region: true, lastReport: true, endpointHost: true,
          transport: true, obfuscation: true, enabled: true, kind: true,
        },
      },
    },
  });

  const label = typeof body.label === "string" ? sanitizeText(body.label).trim().slice(0, 80) : "";
  /* Режим не передали — оставляем прежний выбор человека, а для нового пира берём
     «весь трафик»: это то, чего ждут от VPN по умолчанию. */
  const routing = isVpnRouting(body.routing) ? body.routing : existing?.routing ?? "ALL";

  // Повторная регистрация с того же аккаунта заменяет ключ: старое устройство
  // теряет доступ. Это и есть правило «один аккаунт — один ключ».
  if (existing && existing.node.enabled && existing.node.kind === "VPN") {
    const updated = await prisma.vpnPeer.update({
      where: { userId: session.user.id },
      /* `enabled: true` — на случай, когда пира когда-то выключили: иначе
         перевыпуск ключа возвращал бы профиль, по которому туннель не поднимется
         (узлу такой пир не отдаётся), и причина была бы совершенно не видна. */
      data: { publicKey, label: label || existing.label, lastHandshakeAt: null, enabled: true, routing },
    });
    return NextResponse.json({
      peer: peerView(updated, existing.node, nodeTunnel(existing.node), settings),
      replaced: existing.publicKey !== publicKey,
    });
  }

  // Пира ещё нет (или его узел выключен) — выбираем узел заново.
  const picked = await pickVpnNode(settings.maxPeersPerNode);
  if (!picked) {
    return NextResponse.json(
      { error: "Нет доступного VPN-узла. Добавьте узел с назначением VPN и дождитесь его отчёта." },
      { status: 503 },
    );
  }

  /* Прежний адрес сохраняется только при возврате на тот же узел. При переезде
     на другой узел он берётся из подсети нового: там прежний может быть занят. */
  const address = await chooseAddress(picked.node.id, existing);
  if (!address) {
    return NextResponse.json({ error: "В подсети узла не осталось свободных адресов" }, { status: 503 });
  }

  // VPN-EXIT: внешний адрес выхода закрепляется за пиром при выдаче доступа.
  const exitIp = await assignExitIp(picked.node.id, picked.node.publicIps);

  const peer = await prisma.vpnPeer.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, nodeId: picked.node.id, publicKey, address, exitIp, label, routing },
    update: {
      nodeId: picked.node.id,
      publicKey,
      address,
      exitIp,
      label: label || undefined,
      lastHandshakeAt: null,
      enabled: true,
      routing,
    },
  });

  return NextResponse.json({
    peer: peerView(peer, picked.node, picked.wg, settings),
    replaced: !!existing,
  });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const peer = await prisma.vpnPeer.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!peer) return NextResponse.json({ ok: true });

  await prisma.vpnPeer.delete({ where: { id: peer.id } });
  // Узел уберёт пира при следующем отчёте: список приходит ему целиком.
  return NextResponse.json({ ok: true });
}

/**
 * NETLINK: смена сервера без повторного ввода ключа.
 *
 * Ключ остаётся тем же — меняются узел, адрес в его подсети и внешний адрес
 * выхода. Поэтому старый профиль на устройстве перестаёт работать, и об этом
 * ответ говорит прямо (`needsReissue`): тишина после переезда читается как поломка
 * сервиса, а не как собственное действие.
 *
 * Лимит на час стоит не против злоупотребления, а против перебора серверов
 * вслепую: каждая смена требует перевыпуска профиля на устройстве.
 */
export async function PATCH(req: NextRequest) {
  const limited = await rateLimit(req, "vpn-node", { limit: 20, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const settings = await getVpnSettings();
  if (!settings.enabled) {
    return NextResponse.json({ error: "Сервис отключён администратором" }, { status: 503 });
  }
  if (!(await hasVpnEntitlement(session.user.id))) {
    return NextResponse.json(
      { error: `Соединение доступно по подписке ${LINK_PLAN_QUOTED} или по Premium` },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as { nodeId?: unknown } | null;
  const nodeId = typeof body?.nodeId === "string" ? body.nodeId.trim() : "";
  if (!nodeId) return NextResponse.json({ error: "Не указан сервер" }, { status: 400 });

  const peer = await prisma.vpnPeer.findUnique({
    where: { userId: session.user.id },
    select: { id: true, nodeId: true, address: true },
  });
  if (!peer) {
    return NextResponse.json({ error: "Соединение ещё не настроено" }, { status: 409 });
  }
  if (peer.nodeId === nodeId) {
    return NextResponse.json({ error: "Вы уже на этом сервере" }, { status: 409 });
  }

  const node = await prisma.serverNode.findFirst({
    where: { id: nodeId, kind: "VPN", enabled: true },
    select: {
      id: true,
      name: true,
      region: true,
      publicIps: true,
      lastReport: true,
      endpointHost: true,
      transport: true,
      obfuscation: true,
      _count: { select: { vpnPeers: true } },
    },
  });
  if (!node) return NextResponse.json({ error: "Сервер недоступен" }, { status: 404 });

  const wg = nodeTunnel(node);
  if (!wg.publicKey || !wg.endpoint) {
    return NextResponse.json({ error: "Сервер ещё не вышел на связь" }, { status: 409 });
  }
  if (node._count.vpnPeers >= settings.maxPeersPerNode) {
    return NextResponse.json({ error: "Сервер заполнен — выберите другой" }, { status: 409 });
  }

  /* Адрес берётся из подсети НОВОГО узла: там прежний может быть занят другим. */
  const address = await allocateAddress(node.id);
  if (!address) {
    return NextResponse.json({ error: "На сервере не осталось свободных адресов" }, { status: 409 });
  }
  const exitIp = await assignExitIp(node.id, node.publicIps ?? "");

  const updated = await prisma.vpnPeer.update({
    where: { id: peer.id },
    data: {
      nodeId: node.id,
      address,
      exitIp,
      /* Рукопожатие старого узла к новому отношения не имеет: оставленное
         значение показывало бы «на связи» у только что переехавшего пира. */
      lastHandshakeAt: null,
    },
    include: {
      node: {
        select: { name: true, region: true, lastReport: true, endpointHost: true, transport: true, obfuscation: true },
      },
    },
  });

  return NextResponse.json({
    ok: true,
    needsReissue: true,
    peer: { ...peerView(updated, updated.node, nodeTunnel(updated.node), settings), nodeId: updated.nodeId },
  });
}
