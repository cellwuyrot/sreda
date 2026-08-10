/**
 * STORAGE-PRIORITY: где должен лежать загруженный файл.
 *
 * Раньше ответ был один: на машине приложения. Реестр узлов в админке вёл
 * список серверов, но место файла от него не зависело — можно было завести узел
 * хранения и не увидеть никакой разницы. Здесь появляется правило, и оно ровно
 * такое, как просили:
 *
 *   нет дочернего узла хранения  → файл идёт на главный сервер;
 *   узел появился                → новые файлы идут на него, накопленные
 *                                  переносятся;
 *   узел пропал                  → загрузка не падает, файл остаётся на главном.
 *
 * Последняя строчка — главная. Хранилище на отдельной машине означает сеть между
 * файлом и человеком, а сеть иногда не работает. Поэтому местом по умолчанию
 * навсегда остаётся локальный диск: узел — это приоритет, а не единственный
 * путь. Загрузка, которая падает из-за недоступного узла, хуже загрузки,
 * которая молча легла на главный сервер и переедет позже.
 *
 * Почему узел — объектное хранилище (S3-совместимое, например MinIO), а не наш
 * агент. У дочерних узлов намеренно нет входящего API: связка работает «на
 * вытягивание», узел сам приходит к главному серверу (см. docs/explainers/
 * server-mesh.md). Файл же нужно именно ПОЛОЖИТЬ на узел, то есть обратиться к
 * нему — и вместо своего протокола берётся готовый, у которого есть проверенная
 * реализация, права доступа и совместимость с любым внешним хранилищем, если
 * когда-нибудь понадобится оно, а не своя машина.
 *
 * Здесь только выбор — без сети, без базы и без времени по часам процесса.
 * Всё это в uploadOffload.ts; так правило можно проверить целиком.
 */

/** Узел в том виде, в каком он нужен для выбора. */
export interface PlacementNode {
  id: string;
  name: string;
  role: string;
  kind: string;
  enabled: boolean;
  storageEndpoint: string;
  storageBucket: string;
  storageKeyId: string;
  /** Признак, что секретный ключ задан. Сам ключ сюда не попадает. */
  hasSecret: boolean;
}

export interface PickOptions {
  /**
   * Узлы, на которые только что не получилось положить файл, и до какого
   * времени их не трогать. Без этого каждая загрузка ждала бы ответа от
   * лежащего узла: одна упавшая машина превращалась бы в тормоза для всех.
   */
  cooldown?: Map<string, number>;
  /** Текущее время в миллисекундах — передаётся, чтобы правило проверялось. */
  now?: number;
  /** Сколько файлов уже лежит на каждом узле: выбираем наименее нагруженный. */
  load?: Map<string, number>;
}

/**
 * Адрес пригоден: только http(s) и обязательно с хостом. Проверяем здесь, а не
 * при сохранении: настройку могли завести до этой правки или поправить в базе
 * руками, а неверный адрес должен означать «узла нет», а не падение загрузки.
 */
export function isUsableEndpoint(value: string): boolean {
  if (!value || value.length > 300) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch {
    return false;
  }
}

/** Узел настроен полностью: адрес, корзина и ключи. */
export function isStorageConfigured(node: PlacementNode): boolean {
  return (
    isUsableEndpoint(node.storageEndpoint) &&
    !!node.storageBucket.trim() &&
    !!node.storageKeyId.trim() &&
    node.hasSecret
  );
}

/**
 * Узлы, годные принимать файлы, в порядке предпочтения.
 *
 * Главный сервер в список не попадает даже с настроенным хранилищем: смысл
 * правки в том, чтобы файлы уходили С него, а не ложились на него другим путём.
 */
export function storageCandidates(nodes: PlacementNode[], options: PickOptions = {}): PlacementNode[] {
  const now = options.now ?? Date.now();
  const cooldown = options.cooldown;
  const load = options.load;

  return nodes
    .filter((node) => node.kind === "STORAGE")
    .filter((node) => node.enabled)
    .filter((node) => node.role !== "MAIN")
    .filter((node) => isStorageConfigured(node))
    .filter((node) => {
      const until = cooldown?.get(node.id);
      return !until || until <= now;
    })
    .sort((a, b) => {
      const byLoad = (load?.get(a.id) ?? 0) - (load?.get(b.id) ?? 0);
      if (byLoad !== 0) return byLoad;
      /* Порядок при равной нагрузке должен быть устойчивым, иначе один и тот же
         набор узлов давал бы разный ответ от запуска к запуску, и разобраться,
         куда уехал файл, было бы нечем. */
      return a.name.localeCompare(b.name, "ru");
    });
}

/**
 * Узел для нового файла или null — «оставить на главном сервере».
 *
 * null здесь не ошибка, а рабочий ответ: именно так система вела себя до
 * появления узлов и так же ведёт себя, когда узел выключен или не отвечает.
 */
export function pickStorageNode(nodes: PlacementNode[], options: PickOptions = {}): PlacementNode | null {
  return storageCandidates(nodes, options)[0] ?? null;
}

/**
 * Имя объекта в корзине. Совпадает с путём на диске («messages/uuid.webp»)
 * намеренно: содержимое корзины читается глазами так же, как каталог, и файл
 * можно вернуть на диск обычным копированием, без разбора соответствий.
 */
export function storageObjectKey(relPath: string): string {
  return relPath.replace(/^\/+/, "");
}

/**
 * Нужно ли переносить файл, который уже лежит где-то.
 *
 * Перенос идёт в одну сторону — с главного сервера на узел. Обратно файлы
 * возвращаются только явным действием администратора: молча стаскивать их
 * назад при первой же недоступности узла означало бы гонять терабайты туда-сюда
 * из-за короткого обрыва связи.
 */
export function needsMigration(file: { nodeId: string | null }, target: PlacementNode | null): boolean {
  if (!target) return false;
  return file.nodeId !== target.id && file.nodeId === null;
}
