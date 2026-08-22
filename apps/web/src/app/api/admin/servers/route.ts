import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { isTransport, normalizeWgEndpoint, parsePublicIps, rebalanceExitIps } from "@/lib/vpn";
import {
  isNodeKind,
  isNodeRole,
  issueAgentToken,
  nodeStatus,
} from "@/lib/serverMesh";
import { encrypt } from "@/lib/encryption";
import { isUsableEndpoint } from "@/lib/storagePlacement";
import { resetPlacementCache } from "@/lib/uploadOffload";

// SERVER-MESH: управление реестром серверов. Только ADMIN — редактор сюда не
// допускается: узлы и их токены дают доступ к инфраструктуре, а не к контенту.

const MAX_NAME = 60;
const MAX_URL = 200;

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session.user;
}

/** Наружу токен не отдаём никогда — только признак, что он выпущен. */
function publicNode(node: {
  id: string;
  name: string;
  role: string;
  kind: string;
  url: string;
  endpointHost: string;
  transport: string;
  obfuscation: string;
  region: string;
  publicIps: string;
  storageEndpoint: string;
  storageBucket: string;
  storageRegion: string;
  storageKeyId: string;
  storageSecretEnc: string;
  tokenHash: string | null;
  lastReport: string | null;
  lastSeenAt: Date | null;
  enabled: boolean;
  note: string;
  createdAt: Date;
}) {
  let report: unknown = null;
  if (node.lastReport) {
    try {
      report = JSON.parse(node.lastReport);
    } catch {
      report = null;
    }
  }
  return {
    id: node.id,
    name: node.name,
    role: node.role,
    kind: node.kind,
    url: node.url,
    // VPN-ENDPOINT: у WireGuard нет URL — точка подключения это host:port по UDP.
    endpointHost: node.endpointHost,
    transport: node.transport,
    /* Наружу отдаём только признак «узел сообщил параметры», а не сами
       параметры: администратору важно, готов узел или нет, а значения он всё
       равно не редактирует — их присылает сам узел. */
    hasObfuscation: !!node.obfuscation && node.obfuscation !== "{}",
    region: node.region,
    publicIps: node.publicIps,
    /* STORAGE-PRIORITY: настройки хранилища видны администратору — кроме
       секретного ключа. Наружу уходит только признак, что он задан: показать
       ключ незачем, а один случайный снимок экрана отдаёт вместе с ним все
       файлы проекта. */
    storageEndpoint: node.storageEndpoint,
    storageBucket: node.storageBucket,
    storageRegion: node.storageRegion,
    storageKeyId: node.storageKeyId,
    hasStorageSecret: !!node.storageSecretEnc,
    hasToken: !!node.tokenHash,
    lastSeenAt: node.lastSeenAt,
    status: nodeStatus(node.lastSeenAt, node.enabled),
    enabled: node.enabled,
    note: node.note,
    createdAt: node.createdAt,
    report,
  };
}

function cleanUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim().slice(0, MAX_URL);
  try {
    const parsed = new URL(raw);
    // Узел опрашивается служебными запросами, поэтому только http(s).
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return "";
  }
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const nodes = await prisma.serverNode.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ nodes: nodes.map(publicNode) });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | {
        name?: unknown;
        role?: unknown;
        kind?: unknown;
        url?: unknown;
        endpointHost?: unknown;
        transport?: unknown;
        region?: unknown;
        note?: unknown;
      }
    | null;

  const name = typeof body?.name === "string" ? sanitizeText(body.name).trim().slice(0, MAX_NAME) : "";
  if (!name) return NextResponse.json({ error: "Укажите название узла" }, { status: 400 });

  const role = isNodeRole(body?.role) ? body.role : "CHILD";
  const kind = isNodeKind(body?.kind) ? body.kind : "APP";

  // Главный сервер ровно один: иначе дочерние узлы не поймут, кому подчиняться.
  if (role === "MAIN") {
    const existingMain = await prisma.serverNode.findFirst({ where: { role: "MAIN" }, select: { id: true } });
    if (existingMain) {
      return NextResponse.json({ error: "Главный сервер уже назначен — измените существующий" }, { status: 409 });
    }
  }

  const duplicate = await prisma.serverNode.findUnique({ where: { name }, select: { id: true } });
  if (duplicate) return NextResponse.json({ error: "Узел с таким названием уже есть" }, { status: 409 });

  // Токен нужен только дочерним узлам: главный сервер — это мы сами.
  const issued = role === "CHILD" ? issueAgentToken() : null;

  const node = await prisma.serverNode.create({
    data: {
      name,
      role,
      kind,
      url: cleanUrl(body?.url),
      endpointHost: normalizeWgEndpoint(body?.endpointHost),
      // FIX-NOAWG: тип подключения теперь только обычный — выбирать нечего.
      transport: "PLAIN",
      region: typeof body?.region === "string" ? sanitizeText(body.region).trim().slice(0, 60) : "",
      note: typeof body?.note === "string" ? sanitizeText(body.note).trim().slice(0, 300) : "",
      tokenHash: issued?.tokenHash ?? null,
    },
  });

  // Токен возвращается ЕДИНСТВЕННЫЙ раз — дальше в базе только его хеш.
  return NextResponse.json({ node: publicNode(node), token: issued?.token ?? null });
}

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | {
        id?: unknown;
        name?: unknown;
        kind?: unknown;
        url?: unknown;
        endpointHost?: unknown;
        transport?: unknown;
        region?: unknown;
        note?: unknown;
        publicIps?: unknown;
        storageEndpoint?: unknown;
        storageBucket?: unknown;
        storageRegion?: unknown;
        storageKeyId?: unknown;
        storageSecret?: unknown;
        clearStorageSecret?: unknown;
        enabled?: unknown;
        rotateToken?: unknown;
      }
    | null;

  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Не указан узел" }, { status: 400 });

  const node = await prisma.serverNode.findUnique({ where: { id } });
  if (!node) return NextResponse.json({ error: "Узел не найден" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof body?.name === "string") {
    const name = sanitizeText(body.name).trim().slice(0, MAX_NAME);
    if (!name) return NextResponse.json({ error: "Название не может быть пустым" }, { status: 400 });
    if (name !== node.name) {
      const clash = await prisma.serverNode.findUnique({ where: { name }, select: { id: true } });
      if (clash) return NextResponse.json({ error: "Узел с таким названием уже есть" }, { status: 409 });
    }
    data.name = name;
  }
  if (isNodeKind(body?.kind)) data.kind = body.kind;
  if (body?.url !== undefined) data.url = cleanUrl(body.url);
  /* VPN-ENDPOINT: значение из панели главнее того, что узел пишет о себе в
     отчёте — узел за NAT своего публичного адреса не знает. Разбор срезает
     схему и подставляет стандартный порт, поэтому вставленная ссылка тоже
     превратится в рабочее значение, а не в пустое поле. */
  if (body?.endpointHost !== undefined) data.endpointHost = normalizeWgEndpoint(body.endpointHost);
  /* FIX-NOAWG: режим маскировки убран. Обращения со старого интерфейса или сторонние
     запросы не отклоняются ошибкой, а приводятся к обычному типу: так любая
     правка карточки заодно лечит узлы, помеченные «устойчивыми» раньше. */
  if (isTransport(body?.transport)) data.transport = body.transport;
  if (typeof body?.region === "string") data.region = sanitizeText(body.region).trim().slice(0, 60);
  if (typeof body?.note === "string") data.note = sanitizeText(body.note).trim().slice(0, 300);
  if (typeof body?.enabled === "boolean") data.enabled = body.enabled;
  // VPN-EXIT: пул внешних адресов. Нераспознанные значения молча отбрасываются
  // разбором, поэтому в базу попадает уже вычищенный список.
  if (typeof body?.publicIps === "string") data.publicIps = parsePublicIps(body.publicIps).join(", ");

  /* STORAGE-PRIORITY: параметры хранилища узла. Проверяем строго: неверный
     адрес или пустая корзина означают, что узел молча выпадет из выбора, и
     администратор будет гадать, почему файлы остаются на главном сервере.
     Лучше отказать сразу и словами. */
  if (body?.storageEndpoint !== undefined) {
    const endpoint = typeof body.storageEndpoint === "string" ? body.storageEndpoint.trim().slice(0, 300) : "";
    if (endpoint && !isUsableEndpoint(endpoint)) {
      return NextResponse.json({ error: "Адрес хранилища должен быть http(s) со указанием хоста" }, { status: 400 });
    }
    data.storageEndpoint = endpoint;
  }
  if (body?.storageBucket !== undefined) {
    const bucket = typeof body.storageBucket === "string" ? body.storageBucket.trim().toLowerCase().slice(0, 63) : "";
    if (bucket && !/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)) {
      return NextResponse.json({ error: "Имя корзины: латиница, цифры, точка и дефис" }, { status: 400 });
    }
    data.storageBucket = bucket;
  }
  if (body?.storageRegion !== undefined) {
    const region = typeof body.storageRegion === "string" ? body.storageRegion.trim().slice(0, 40) : "";
    data.storageRegion = region || "us-east-1";
  }
  if (body?.storageKeyId !== undefined) {
    const keyId = typeof body.storageKeyId === "string" ? body.storageKeyId.trim().slice(0, 128) : "";
    data.storageKeyId = keyId;
  }
  /* Секрет приходит один раз и сразу шифруется. Пустая строка означает «поле не
     трогали» — иначе форма, где ключ не показывается, стирала бы его при каждом
     сохранении соседнего поля. Убрать ключ можно явным clearStorageSecret. */
  if (typeof body?.storageSecret === "string" && body.storageSecret.trim()) {
    data.storageSecretEnc = encrypt(body.storageSecret.trim().slice(0, 256));
  }
  if (body?.clearStorageSecret === true) data.storageSecretEnc = "";

  // Перевыпуск токена немедленно обрывает связь прежнего агента.
  let token: string | null = null;
  if (body?.rotateToken === true) {
    if (node.role === "MAIN") {
      return NextResponse.json({ error: "Главному серверу токен агента не нужен" }, { status: 400 });
    }
    const issued = issueAgentToken();
    data.tokenHash = issued.tokenHash;
    token = issued.token;
  }

  const updated = await prisma.serverNode.update({ where: { id }, data });

  /* VPN-EXIT: пул внешних адресов правит человек, и убранный адрес оставался
     закреплённым за пирами — узел делал SNAT на адрес, которого на машине уже
     нет, и у таких людей молча пропадал выход в интернет при поднятом туннеле.
     Поэтому после смены пула затронутые пиры получают адреса заново. */
  if (typeof data.publicIps === "string") {
    await rebalanceExitIps(id, data.publicIps).catch(() => null);
  }

  /* Выбор узла для новых файлов держится в памяти полминуты. После правки
     настроек ждать эти полминуты незачем — иначе администратор нажимает
     «перенести» сразу после настройки и видит, что ничего не произошло. */
  resetPlacementCache();

  return NextResponse.json({ node: publicNode(updated), token });
}

export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Не указан узел" }, { status: 400 });

  const node = await prisma.serverNode.findUnique({ where: { id }, select: { id: true } });
  if (!node) return NextResponse.json({ error: "Узел не найден" }, { status: 404 });

  /* STORAGE-PRIORITY: на узле могут лежать файлы. Удалить запись означало бы
     оставить указатели в пустоту — вложения в переписке перестали бы
     открываться, и восстановить связь было бы нечем. Поэтому сначала возврат
     файлов на главный сервер, и только потом удаление. */
  const stored = await prisma.uploadedFile.count({ where: { nodeId: id } }).catch(() => 0);
  if (stored > 0) {
    return NextResponse.json(
      {
        error: `На узле ${stored} файлов. Сначала верните их на главный сервер — «Вернуть файлы» в карточке узла.`,
      },
      { status: 409 },
    );
  }

  await prisma.serverNode.delete({ where: { id } });
  resetPlacementCache();
  return NextResponse.json({ ok: true });
}
