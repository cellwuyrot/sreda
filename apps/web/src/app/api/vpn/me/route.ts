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
} from "@/lib/vpn";

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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getVpnSettings();
  const entitled = await hasVpnEntitlement(session.user.id);
  const peer = await prisma.vpnPeer.findUnique({
    where: { userId: session.user.id },
    include: {
      node: {
        select: { name: true, region: true, lastReport: true, endpointHost: true, transport: true, obfuscation: true },
      },
    },
  });

  // Признак «узел готов принимать пиров» нужен клиенту заранее: если ни один
  // узел ещё не отчитался, автоматическая выдача просто не сработает, и честнее
  // сказать это до нажатия кнопки, а не после.
  const nodeReady = settings.enabled ? !!(await pickVpnNode(settings.maxPeersPerNode)) : false;

  if (!peer) {
    return NextResponse.json({ peer: null, serviceEnabled: settings.enabled, entitled, nodeReady });
  }

  return NextResponse.json({
    serviceEnabled: settings.enabled,
    entitled,
    nodeReady,
    peer: peerView(peer, peer.node, nodeTunnel(peer.node), settings),
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
    return NextResponse.json({ error: "Сервис VPN отключён администратором" }, { status: 503 });
  }

  // VPN-AUTOPREMIUM: единственное условие выдачи.
  if (!(await hasVpnEntitlement(session.user.id))) {
    return NextResponse.json({ error: "VPN доступен с подпиской Premium" }, { status: 403 });
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
