import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import {
  VPN_SERVER_ADDRESS,
  assignExitIp,
  chooseAddress,
  getVpnSettings,
  isValidWireGuardKey,
  pickVpnNode,
  readWgReport,
  routingAllowedIps,
} from "@/lib/vpn";

/**
 * VPN-ADMINPEER: выдача доступа администратором по публичному ключу.
 *
 * Зачем: раньше зарегистрировать ключ можно было только запросом от своего
 * имени (`POST /api/vpn/me`), а из консоли для этого нужна session-cookie — на
 * практике это оказалось неподъёмно неудобно. Здесь админ просто вставляет
 * 44 символа публичного ключа и указывает, кому выдать.
 *
 * Приватный ключ по-прежнему НЕ участвует: он существует только на устройстве
 * владельца. Если в теле окажется поле `privateKey`, запрос отклоняется — чтобы
 * ошибка в чужом скрипте не превратилась в утечку секрета на сервер.
 */

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session.user;
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await getVpnSettings();
  if (!settings.enabled) {
    return NextResponse.json({ error: "Сервис отключён — включите его выше" }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as
    | { username?: unknown; userId?: unknown; publicKey?: unknown; privateKey?: unknown; label?: unknown }
    | null;

  if (body?.privateKey !== undefined) {
    return NextResponse.json(
      { error: "Приватный ключ на сервер не передаётся. Нужен только публичный." },
      { status: 400 },
    );
  }

  if (!isValidWireGuardKey(body?.publicKey)) {
    return NextResponse.json(
      { error: "Публичный ключ WireGuard — ровно 44 символа base64, заканчивается на «=»" },
      { status: 400 },
    );
  }
  const publicKey = body.publicKey;

  // Получателя можно указать логином (так удобнее из панели) или id.
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const username = typeof body?.username === "string" ? body.username.trim().replace(/^@/, "") : "";
  if (!userId && !username) {
    return NextResponse.json({ error: "Укажите получателя: логин или id" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: userId ? { id: userId } : { username },
    select: { id: true, name: true, username: true },
  });
  if (!user) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  // Один ключ не может принадлежать двум аккаунтам.
  const keyOwner = await prisma.vpnPeer.findUnique({ where: { publicKey }, select: { userId: true } });
  if (keyOwner && keyOwner.userId !== user.id) {
    return NextResponse.json({ error: "Этот ключ уже занят другим аккаунтом" }, { status: 409 });
  }

  const label = typeof body?.label === "string"
    ? sanitizeText(body.label).trim().slice(0, 80)
    : "";

  // Один публичный ключ — одно устройство.
  const existing = await prisma.vpnPeer.findUnique({
    where: { publicKey },
    include: {
      node: {
        select: {
          id: true, name: true, region: true, lastReport: true,
          enabled: true, kind: true,
        },
      },
    },
  });

  if (existing && existing.userId !== user.id) {
    return NextResponse.json({ error: "Этот ключ уже занят другим аккаунтом" }, { status: 409 });
  }

  const deviceCount = await prisma.vpnPeer.count({
    where: { userId: user.id },
  });

  if (!existing && deviceCount >= 5) {
    return NextResponse.json(
      { error: "Достигнут лимит: не более 5 устройств на аккаунт" },
      { status: 409 },
    );
  }

  // Повторная выдача того же ключа обновляет только его устройство.
  if (existing && existing.node.enabled && existing.node.kind === "VPN") {
    const updated = await prisma.vpnPeer.update({
      where: { id: existing.id },
      data: {
        label: label || existing.label,
        lastHandshakeAt: null,
        enabled: true,
      },
    });

    const wg = readWgReport(existing.node.lastReport);
    return NextResponse.json({
      created: false,
      replaced: false,
      user,
      peer: {
        address: updated.address,
        exitIp: updated.exitIp,
        node: existing.node.name,
      },
      tunnel: {
        serverPublicKey: wg.publicKey,
        endpoint: wg.endpoint,
        allowedIps: routingAllowedIps(settings, updated.routing),
        dns: settings.dns,
        serverAddress: VPN_SERVER_ADDRESS,
        address: updated.address,
      },
    });
  }

  const picked = await pickVpnNode(settings.maxPeersPerNode);
  if (!picked) {
    return NextResponse.json(
      { error: "Нет свободного VPN-сервера" },
      { status: 503 },
    );
  }

  const address = await chooseAddress(picked.node.id, existing);
  if (!address) {
    return NextResponse.json(
      { error: "В подсети узла не осталось свободных адресов" },
      { status: 503 },
    );
  }

  const exitIp = existing?.nodeId === picked.node.id
    ? existing.exitIp
    : await assignExitIp(picked.node.id, picked.node.publicIps);

  const peerData = {
    nodeId: picked.node.id,
    publicKey,
    address,
    exitIp,
    label: label || existing?.label || "",
    lastHandshakeAt: null,
    enabled: true,
    configAt: new Date(),
  };

  const peer = existing
    ? await prisma.vpnPeer.update({
        where: { id: existing.id },
        data: peerData,
      })
    : await prisma.vpnPeer.create({
        data: { ...peerData, userId: user.id },
      });

  return NextResponse.json({
    created: !existing,
    replaced: false,
    user,
    peer: {
      address: peer.address,
      exitIp: peer.exitIp,
      node: picked.node.name,
    },
    tunnel: {
      serverPublicKey: picked.wg.publicKey,
      endpoint: picked.wg.endpoint,
      allowedIps: routingAllowedIps(settings, peer.routing),
      dns: settings.dns,
      serverAddress: VPN_SERVER_ADDRESS,
      address: peer.address,
    },
  });
}
