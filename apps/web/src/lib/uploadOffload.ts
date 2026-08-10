/**
 * STORAGE-PRIORITY: переезд файла на узел хранения и обратная дорога к нему.
 *
 * Правило выбора живёт в storagePlacement.ts, разговор с хранилищем — в
 * objectStore.ts, а здесь то, что их связывает: база, диск и решение, что
 * делать, когда узел не отвечает.
 *
 * Порядок действий при переносе жёсткий и именно такой:
 *
 *   1. положить копию на узел и убедиться, что она там;
 *   2. только потом записать в базу, что файл на узле;
 *   3. и только потом удалить локальный.
 *
 * Любой другой порядок теряет файлы. Записать указатель раньше копии — и до
 * конца копирования файл недоступен. Удалить локальный раньше указателя — и
 * падение между двумя шагами оставит запись, указывающую в пустоту. При этом
 * порядке худшее, что может случиться, — лишняя копия на узле: она перезапишется
 * при следующей попытке и никому не мешает.
 *
 * Ничего из этого не должно ронять загрузку. Человек нажал «отправить» — файл
 * обязан отправиться, даже если узел в этот момент выключен. Поэтому все ошибки
 * здесь гасятся и превращаются в «оставить на главном сервере»; узел получит
 * этот файл позже, при переносе накопленного.
 */

import { readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import prisma from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { uploadContentType, uploadDirRoot } from "@/lib/uploadPaths";
import {
  pickStorageNode,
  storageObjectKey,
  type PlacementNode,
} from "@/lib/storagePlacement";
import { deleteObject, getObject, headObject, putObject, type StorageTarget } from "@/lib/objectStore";

/** Узел, на который только что не получилось положить файл, не трогаем минуту. */
const COOLDOWN_MS = 60_000;
/** Список узлов меняется редко, а загрузок много: держим его недолго в памяти. */
const NODES_TTL_MS = 30_000;

const cooldown = new Map<string, number>();
let nodesCache: { at: number; nodes: PlacementNode[] } | null = null;

/** Сбросить кэш выбора. Нужен админке сразу после правки настроек узла. */
export function resetPlacementCache(): void {
  nodesCache = null;
  cooldown.clear();
}

interface NodeRow {
  id: string;
  name: string;
  role: string;
  kind: string;
  enabled: boolean;
  storageEndpoint: string;
  storageBucket: string;
  storageRegion: string;
  storageKeyId: string;
  storageSecretEnc: string;
}

async function loadNodes(): Promise<NodeRow[]> {
  const rows = await prisma.serverNode.findMany({
    where: { kind: "STORAGE" },
    select: {
      id: true,
      name: true,
      role: true,
      kind: true,
      enabled: true,
      storageEndpoint: true,
      storageBucket: true,
      storageRegion: true,
      storageKeyId: true,
      storageSecretEnc: true,
    },
  });
  return Array.isArray(rows) ? (rows as NodeRow[]) : [];
}

function toPlacement(row: NodeRow): PlacementNode {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    kind: row.kind,
    enabled: row.enabled,
    storageEndpoint: row.storageEndpoint,
    storageBucket: row.storageBucket,
    storageKeyId: row.storageKeyId,
    hasSecret: !!row.storageSecretEnc,
  };
}

/**
 * Настройки обращения к узлу. Секрет расшифровывается только здесь и наружу
 * этого модуля не выходит.
 */
export function targetFor(row: NodeRow): StorageTarget | null {
  try {
    const secret = decrypt(row.storageSecretEnc);
    if (!secret) return null;
    return {
      endpoint: row.storageEndpoint,
      bucket: row.storageBucket,
      region: row.storageRegion || "us-east-1",
      keyId: row.storageKeyId,
      secret,
    };
  } catch {
    /* Ключ шифрования сменился или значение испорчено. Это не повод ронять
       загрузку: узел просто считается ненастроенным. */
    return null;
  }
}

/** Узел для новых файлов или null — «главный сервер». */
export async function currentTargetNode(): Promise<NodeRow | null> {
  const now = Date.now();
  let rows: NodeRow[];
  try {
    if (nodesCache && now - nodesCache.at < NODES_TTL_MS) {
      rows = nodesCache.nodes as unknown as NodeRow[];
    } else {
      rows = await loadNodes();
      nodesCache = { at: now, nodes: rows as unknown as PlacementNode[] };
    }
  } catch {
    return null;
  }

  const picked = pickStorageNode(rows.map(toPlacement), { cooldown, now });
  if (!picked) return null;
  return rows.find((row) => row.id === picked.id) ?? null;
}

function localPathFor(relPath: string): string {
  const dir = relPath.split("/")[0] ?? "";
  return path.join(uploadDirRoot(dir), path.basename(relPath));
}

/**
 * Перенести один файл с диска на узел.
 *
 * Возвращает true, если файл теперь на узле. false — «остался на главном
 * сервере», и это нормальный исход, а не сбой: см. заголовок файла.
 */
export async function offloadUpload(relPath: string): Promise<boolean> {
  const node = await currentTargetNode();
  if (!node) return false;

  const target = targetFor(node);
  if (!target) return false;

  const filePath = localPathFor(relPath);
  if (!existsSync(filePath)) return false;

  const key = storageObjectKey(relPath);
  try {
    const body = await readFile(filePath);
    const dir = relPath.split("/")[0] ?? "";
    await putObject(target, key, body, uploadContentType(dir, path.extname(relPath)));

    /* Проверка после записи: хранилище подтвердило приём, но подтверждение и
       сохранность — разные вещи. Сравнение размера стоит один запрос и ловит
       обрыв на середине, после которого файл открывался бы битым. */
    const remoteSize = await headObject(target, key);
    if (remoteSize !== null && remoteSize !== body.length) {
      throw new Error(`на узле ${remoteSize} байт вместо ${body.length}`);
    }

    await prisma.uploadedFile.updateMany({
      where: { path: relPath },
      data: { nodeId: node.id, size: body.length },
    });

    /* Локальную копию убираем последней. Если здесь упадёт — файл просто
       останется лежать лишним на диске, а раздача уже идёт с узла. */
    await unlink(filePath).catch(() => null);
    return true;
  } catch (err) {
    cooldown.set(node.id, Date.now() + COOLDOWN_MS);
    console.warn(`[storage] файл ${relPath} остался на главном сервере: ${(err as Error).message}`);
    return false;
  }
}

/** Запустить перенос, не заставляя человека его ждать. */
export function scheduleOffload(relPath: string): void {
  void offloadUpload(relPath).catch(() => false);
}

export interface RemoteFile {
  nodeId: string;
  nodeName: string;
  target: StorageTarget;
  key: string;
}

/**
 * Где лежит файл: на узле или на главном сервере.
 *
 * Вызывается раздатчиком только тогда, когда локального файла нет — то есть по
 * одному разу на каждый файл, который действительно уехал. Порядок «сначала
 * диск, потом база» выбран ради обычного случая: пока хранилище на главном
 * сервере, ни один запрос за вложением не превращается в запрос к базе.
 */
export async function remoteLocationFor(relPath: string): Promise<RemoteFile | null> {
  let record: { nodeId: string | null } | null = null;
  try {
    record = await prisma.uploadedFile.findUnique({
      where: { path: relPath },
      select: { nodeId: true },
    });
  } catch {
    return null;
  }
  if (!record?.nodeId) return null;

  let row: NodeRow | null = null;
  try {
    row = (await prisma.serverNode.findUnique({
      where: { id: record.nodeId },
      select: {
        id: true,
        name: true,
        role: true,
        kind: true,
        enabled: true,
        storageEndpoint: true,
        storageBucket: true,
        storageRegion: true,
        storageKeyId: true,
        storageSecretEnc: true,
      },
    })) as NodeRow | null;
  } catch {
    return null;
  }
  if (!row) return null;

  const target = targetFor(row);
  if (!target) return null;
  return { nodeId: row.id, nodeName: row.name, target, key: storageObjectKey(relPath) };
}

/** Чтение файла с узла — для раздатчика. Заголовок Range пересылается как есть. */
export async function fetchRemote(remote: RemoteFile, range?: string) {
  return getObject(remote.target, remote.key, range);
}

export interface MigrationResult {
  moved: number;
  failed: number;
  remaining: number;
  nodeName: string | null;
}

/**
 * Перенести накопленное — порциями, по требованию администратора.
 *
 * Порциями, а не всё сразу, потому что «всё сразу» на живом сервере означает
 * непредсказуемое время работы запроса и полку по сети посреди рабочего дня.
 * Повторный вызов продолжает с того места, где остановился предыдущий: признак
 * «перенесён» стоит у самого файла, отдельного состояния нет и сбиться нечему.
 */
export async function migrateBatch(limit = 25): Promise<MigrationResult> {
  const node = await currentTargetNode();
  if (!node) return { moved: 0, failed: 0, remaining: 0, nodeName: null };

  const pending = await prisma.uploadedFile.findMany({
    where: { nodeId: null },
    select: { path: true },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(200, limit)),
  });

  let moved = 0;
  let failed = 0;
  for (const file of Array.isArray(pending) ? pending : []) {
    const ok = await offloadUpload(file.path);
    if (ok) moved += 1;
    else failed += 1;
    /* Узел ушёл в отдых — дальше в этой порции смысла нет, только время. */
    if (!ok && cooldown.has(node.id)) break;
  }

  const remaining = await prisma.uploadedFile.count({ where: { nodeId: null } }).catch(() => 0);
  return { moved, failed, remaining, nodeName: node.name };
}

/**
 * Вернуть файл с узла на главный сервер. Нужен ровно в одном случае: узел
 * выводят из работы, и его файлы должны пережить это событие.
 */
export async function restoreToMain(relPath: string): Promise<boolean> {
  const remote = await remoteLocationFor(relPath);
  if (!remote) return false;
  try {
    const res = await getObject(remote.target, remote.key);
    const body = Buffer.from(await res.arrayBuffer());
    const filePath = localPathFor(relPath);
    const { writeFile, mkdir } = await import("fs/promises");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    await prisma.uploadedFile.updateMany({ where: { path: relPath }, data: { nodeId: null } });
    await deleteObject(remote.target, remote.key).catch(() => null);
    return true;
  } catch (err) {
    console.warn(`[storage] не удалось вернуть ${relPath} на главный сервер: ${(err as Error).message}`);
    return false;
  }
}
