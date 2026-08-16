import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { findNodeByToken } from "@/lib/serverMesh";
import { getVpnSettings, isPeerEntitled, isValidWireGuardKey } from "@/lib/vpn";
import { isTrafficBlocked, periodExpired, usageView } from "@/lib/connectionUsage";

// SERVER-MESH: точка отчёта дочернего узла.
//
// Узел раз в минуту присылает своё состояние с токеном агента в заголовке
// Authorization и получает в ответ адрес главного сервера и собственные
// настройки. Ни базы, ни сессий пользователей узел не видит — связка нужна
// только чтобы он знал, кому подчиняется, а панель знала, что он жив.
//
// Отчёт намеренно свободной формы: у VPN-узла это число пиров, у медиа-узла —
// занятое место. Всё, что не входит в белый список ключей, отбрасывается.

const ALLOWED_KEYS = [
  "version",
  "uptimeSeconds",
  "load",
  "peers",
  // NETLINK: суммарный трафик интерфейса и мгновенная скорость — сквозная
  // загруженность узла в панели строится по ним.
  "rxBytes",
  "txBytes",
  "mbitsIn",
  "mbitsOut",
  "storageUsedMb",
  "diskFreeMb",
  "message",
  // VPN-WG: узел сообщает публичный ключ своего интерфейса и точку подключения.
  // Приватного ключа узла тут нет и быть не должно — он не покидает узел.
  "wgPublicKey",
  "endpoint",
  // VPN-TRANSPORT: каким инструментом узел управляет интерфейсом. Значение
  // информационное: тип подключения задаёт администратор в панели, а это лишь
  // подсказка, совпадает ли реальность с настройкой.
  "tool",
] as const;
const MAX_STRING = 200;

function sanitizeReport(value: unknown): Record<string, string | number> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, string | number> = {};
  for (const key of ALLOWED_KEYS) {
    const raw = source[key];
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === "string") out[key] = raw.slice(0, MAX_STRING);
  }
  return out;
}

/**
 * Параметры интерфейса из отчёта: принимаем плоский объект «ключ — число или
 * строка» и сохраняем как JSON. Валидацию значений делает `parseObfuscation`
 * при чтении: там же, где они попадают в профиль, — так проверка не может
 * оказаться пропущенной на каком-то из путей.
 */
function readObfuscation(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return "";
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,7}$/.test(key)) continue;
    if (typeof item === "number" && Number.isFinite(item)) out[key] = item;
    else if (typeof item === "string" && item.length <= 512) out[key] = item;
  }
  return JSON.stringify(out);
}

export async function POST(req: Request) {
  const node = await findNodeByToken(req.headers.get("authorization"));
  if (!node) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { report?: unknown } | null;
  const report = sanitizeReport(body?.report);

  /* VPN-TRANSPORT: параметры интерфейса узла приходят отдельным полем, а не
     внутри отчёта. Отчёт целиком показывается в панели как диагностика, а этим
     значениям там делать нечего: они нужны только для подстановки в профиль. */
  const obfuscation = readObfuscation((body as { obfuscation?: unknown })?.obfuscation);

  await prisma.serverNode.update({
    where: { id: node.id },
    data: {
      lastSeenAt: new Date(),
      lastReport: JSON.stringify(report),
      ...(obfuscation === null ? {} : { obfuscation }),
    },
  });

  // VPN-WG: рукопожатия, о которых доложил узел. Обновляем только своих пиров
  // — по nodeId, чтобы один узел не мог трогать записи другого.
  if (node.kind === "VPN" && Array.isArray((body as { handshakes?: unknown })?.handshakes)) {
    const handshakes = (body as { handshakes: unknown[] }).handshakes.slice(0, 500);
    for (const item of handshakes) {
      if (!item || typeof item !== "object") continue;
      const { publicKey, atMs } = item as { publicKey?: unknown; atMs?: unknown };
      if (!isValidWireGuardKey(publicKey) || typeof atMs !== "number" || !Number.isFinite(atMs)) continue;
      await prisma.vpnPeer
        .updateMany({ where: { nodeId: node.id, publicKey }, data: { lastHandshakeAt: new Date(atMs) } })
        .catch(() => null);
    }
  }

  /* NETLINK: расход трафика по каждому пиру. Узел присылает НАКОПИТЕЛЬНЫЕ
     счётчики интерфейса (то, что показывает `wg show dump`), а при перезапуске
     интерфейса они начинаются с нуля. Поэтому в расход идёт прирост, а не само
     число: иначе одна перезагрузка узла списала бы человеку весь его трафик
     второй раз, а откат счётчика назад дал бы отрицательный расход. */
  if (node.kind === "VPN" && Array.isArray((body as { transfers?: unknown })?.transfers)) {
    const settings = await getVpnSettings();
    const transfers = (body as { transfers: unknown[] }).transfers.slice(0, 500);
    for (const item of transfers) {
      if (!item || typeof item !== "object") continue;
      const { publicKey, rx, tx } = item as { publicKey?: unknown; rx?: unknown; tx?: unknown };
      if (!isValidWireGuardKey(publicKey)) continue;
      const rawRx = typeof rx === "number" && Number.isFinite(rx) && rx >= 0 ? rx : 0;
      const rawTx = typeof tx === "number" && Number.isFinite(tx) && tx >= 0 ? tx : 0;
      const peer = await prisma.vpnPeer.findFirst({
        where: { nodeId: node.id, publicKey },
        select: { id: true, rxBytes: true, txBytes: true, lastRx: true, lastTx: true, usageResetAt: true },
      });
      if (!peer) continue;

      // Счётчик вырос — берём разницу; упал — интерфейс перезапустили,
      // значит вся текущая величина и есть прирост с момента перезапуска.
      const deltaRx = rawRx >= peer.lastRx ? rawRx - peer.lastRx : rawRx;
      const deltaTx = rawTx >= peer.lastTx ? rawTx - peer.lastTx : rawTx;

      /* Ленивый сброс периода — здесь, в единственном месте, где счётчики
         растут. Отдельная задача по расписанию для этого не нужна и только добавила
         бы молчаливо ломающуюся деталь. */
      const expired = periodExpired(peer.usageResetAt, settings.usagePeriodDays);
      await prisma.vpnPeer
        .update({
          where: { id: peer.id },
          data: expired
            ? { rxBytes: deltaRx, txBytes: deltaTx, lastRx: rawRx, lastTx: rawTx, usageResetAt: new Date() }
            : {
                rxBytes: peer.rxBytes + deltaRx,
                txBytes: peer.txBytes + deltaTx,
                lastRx: rawRx,
                lastTx: rawTx,
              },
        })
        .catch(() => null);
    }
  }

  const main = await prisma.serverNode.findFirst({
    where: { role: "MAIN" },
    select: { name: true, url: true, region: true },
  });

  // VPN-WG: узел получает свой список пиров целиком и приводит интерфейс к
  // нему. Модель «на вытягивание»: у узла нет входящего API, поэтому он
  // работает за NAT и не требует обратной аутентификации.
  // VPN-PANEL: выключатель сервиса — настоящий. Выключено значит пустой список
  // пиров, и узел снимает все туннели в течение минуты.
  // VPN-ENTITLEMENT: право на туннель проверяется ЗДЕСЬ, а не только при выдаче.
  // Иначе доступ переживал бы своё основание: кончилась подписка, сняли премиум
  // руками, забанили — узлу пира по-прежнему присылали, и туннель работал. Теперь
  // любая потеря права снимает туннель в течение минуты, без отдельной задачи по
  // расписанию, а запись пира остаётся: вернулась подписка — вернулся доступ.
  const vpnSettings = node.kind === "VPN" ? await getVpnSettings() : null;
  const vpnEnabled = vpnSettings?.enabled ?? false;
  const vpnPeers =
    node.kind !== "VPN" || !vpnSettings
      ? null
      : !vpnEnabled
      ? []
      : (
          await prisma.vpnPeer.findMany({
            where: { nodeId: node.id, enabled: true },
            select: {
              publicKey: true,
              address: true,
              exitIp: true,
              /* NETLINK: расход периода нужен здесь же: лимит — такое же
                 основание доступа, как и сама подписка, и проверяться он должен в той
                 же единственной точке, а не задачей по расписанию. */
              rxBytes: true,
              txBytes: true,
              usageResetAt: true,
              /* VPN-PLAN: право даёт либо Premium, либо подписка только на VPN. */
              user: {
                select: {
                  banned: true,
                  bannedUntil: true,
                  isPremium: true,
                  role: true,
                  vpnAccess: true,
                  vpnAccessUntil: true,
                },
              },
            },
            orderBy: { address: "asc" },
          })
        )
          .filter((peer) => isPeerEntitled(peer.user))
          /* NETLINK: исчерпанный лимит при правиле «отключить» снимает соединение
             тем же способом, что и кончившаяся подписка: пир перестаёт попадать
             в список узла. Запись остаётся — новый период вернёт доступ сам. */
          .filter((peer) => !isTrafficBlocked(peer, vpnSettings))
          .map((peer) => ({
            publicKey: peer.publicKey,
            allowedIp: `${peer.address}/32`,
            // VPN-EXIT: пустая строка — общий MASQUERADE узла (прежнее поведение).
            exitIp: peer.exitIp,
            /* NETLINK: потолок скорости в Кбит/с для тех, кто вышел за лимит при
               правиле «снизить скорость». 0 — ограничений нет. Формирует трафик сам
               узел: через главный сервер этот трафик не проходит вообще. */
            throttleKbps:
              vpnSettings.overLimitAction === "THROTTLE" && usageView(peer, vpnSettings).overLimit
                ? vpnSettings.throttleKbps
                : 0,
          }));

  return NextResponse.json({
    ok: true,
    // Что узел знает о себе — на случай, если админ переименовал или отключил.
    self: { id: node.id, name: node.name, kind: node.kind, url: node.url, region: node.region },
    // Куда обращаться за командами. Пусто, если главный сервер ещё не назначен.
    main: main ? { name: main.name, url: main.url, region: main.region } : null,
    /** Полный список пиров для VPN-узла (null — узел не VPN). */
    peers: vpnPeers,
    /** Через сколько миллисекунд ждать следующий отчёт. */
    nextReportInMs: 60_000,
  });
}
