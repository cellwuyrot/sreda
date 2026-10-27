/**
 * WS-MERGE: чужие правки больше не стирают ваши.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Рабочая среда сохраняется целым снимком: всё состояние одной строкой. Когда
 * приходило известие «состояние изменилось», клиент забирал свежий снимок и
 * **полностью заменял им своё**. Всё, что человек успел сделать за последние
 * секунды и что ещё не доехало до сервера, исчезало без следа и без сообщения.
 *
 * На личной среде это редкость — два своих устройства. На общем холсте канала
 * это обычный вторник: двое двигают карточки, и каждое сохранение одного
 * стирает несохранённое другого.
 *
 * ── Как стало ───────────────────────────────────────────────────────────────
 *
 * Пришедший снимок — основа (это правда сервера), но поверх него возвращаются
 * МОИ карточки, которые я менял и которые ещё не уехали. Итог: у обоих
 * появляется объединение правок, а не работа одного из двух.
 *
 * Что считать «моим изменённым», определяется сравнением с последним снимком,
 * который мы отправили или получили (`diffDirtyIds`). Так не нужно помечать
 * изменения в двух десятках мест, где карточку можно тронуть, — а значит
 * невозможно забыть пометку в двадцать первом месте.
 *
 * ── Сознательный выбор в спорном случае ─────────────────────────────────────
 *
 * Если один удалил карточку, а другой в это же время её правил, карточка
 * **остаётся**. Правка побеждает удаление намеренно: вернуть лишнюю карточку —
 * одно движение, восстановить потерянную работу нельзя ничем.
 */

export interface MergeableCard {
  id: string;
  [key: string]: unknown;
}

export interface MergeableEdge {
  id: string;
  from: string;
  to: string;
  [key: string]: unknown;
}

export interface MergeableBoard {
  id: string;
  cards: MergeableCard[];
  edges: MergeableEdge[];
  [key: string]: unknown;
}

/** Устойчивый отпечаток карточки: по нему видно, менялась ли она. */
function fingerprint(item: unknown): string {
  return JSON.stringify(item);
}

/**
 * Что я успел изменить с прошлой синхронизации.
 *
 * Сравниваются два состояния: последнее известное общее (то, что мы отправили
 * или получили) и текущее на экране. В ответе — идентификаторы карточек и
 * связей, которые добавились или изменились.
 *
 * Удалённые мною НЕ попадают в ответ намеренно: удаление и так уедет обычным
 * сохранением, а вот вносить его в слияние опасно — чужая правка той же
 * карточки должна её сохранить, а не дать удалить (см. заголовок файла).
 */
export function diffDirtyIds(lastSynced: MergeableBoard[], current: MergeableBoard[]): Set<string> {
  const before = new Map<string, string>();
  for (const board of lastSynced) {
    for (const card of board.cards) before.set(card.id, fingerprint(card));
    for (const edge of board.edges) before.set(edge.id, fingerprint(edge));
  }

  const dirty = new Set<string>();
  for (const board of current) {
    for (const card of board.cards) {
      if (before.get(card.id) !== fingerprint(card)) dirty.add(card.id);
    }
    for (const edge of board.edges) {
      if (before.get(edge.id) !== fingerprint(edge)) dirty.add(edge.id);
    }
  }
  return dirty;
}

function mergeItems<T extends { id: string }>(incoming: T[], local: T[], dirty: Set<string>): T[] {
  const result = incoming.slice();
  const index = new Map(result.map((item, i) => [item.id, i]));

  for (const item of local) {
    if (!dirty.has(item.id)) continue; // не трогал — верю серверу
    const at = index.get(item.id);
    if (at === undefined) {
      /* Моей карточки на сервере нет: либо я её только что создал, либо
         кто-то удалил, пока я правил. В обоих случаях оставляем — потерянную
         работу не вернуть, а лишнюю карточку убрать легко. */
      index.set(item.id, result.length);
      result.push(item);
    } else {
      result[at] = item;
    }
  }
  return result;
}

/**
 * Слить пришедшее состояние со своим.
 *
 * Основа — пришедшее: всё, чего я не трогал, берётся оттуда, включая чужие
 * удаления. Поверх возвращаются мои изменённые карточки и связи.
 */
export function mergeBoards(
  incoming: MergeableBoard[],
  local: MergeableBoard[],
  dirty: Set<string>,
): MergeableBoard[] {
  if (dirty.size === 0) return incoming;

  const result = incoming.map((board) => ({ ...board }));
  const byId = new Map(result.map((board, i) => [board.id, i]));

  for (const localBoard of local) {
    const at = byId.get(localBoard.id);

    if (at === undefined) {
      /* Холста нет в пришедшем состоянии. Если на нём есть мои свежие правки —
         значит его удалили (или создал его я) прямо сейчас, и терять его
         нельзя. Пустой и нетронутый холст не возвращаем: это как раз тот
         случай, когда удаление законно. */
      const hasMine =
        localBoard.cards.some((c) => dirty.has(c.id)) || localBoard.edges.some((e) => dirty.has(e.id));
      if (hasMine) result.push({ ...localBoard });
      continue;
    }

    const base = result[at]!;
    result[at] = {
      ...base,
      cards: mergeItems(base.cards, localBoard.cards, dirty),
      edges: mergeItems(base.edges, localBoard.edges, dirty),
    };
  }

  /* Связь, оба конца которой не пережили слияние, — висячая: она рисуется в
     пустоту. Такие убираем, иначе на холсте останутся линии в никуда. */
  return result.map((board) => {
    const ids = new Set(board.cards.map((c) => c.id));
    return { ...board, edges: board.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  });
}

/** Camera position belongs to the viewer, never to a collaborator's update. */
export function preserveLocalViews<T extends { id: string; view?: unknown }>(incoming: T[], local: T[]): T[] {
  const views = new Map(local.map(board => [board.id, board.view]));
  return incoming.map(board => views.has(board.id) ? { ...board, view: views.get(board.id) } : board);
}

/** Ignore per-viewer camera when determining shared edits. */
export function sharedBoardFingerprint(board: MergeableBoard): string {
  const { view: _view, ...shared } = board;
  return JSON.stringify(shared);
}
export function hasWorkspaceChanges(base: MergeableBoard[], local: MergeableBoard[]): boolean {
  return base.length !== local.length || base.some((board, i) => !local[i] || sharedBoardFingerprint(board) !== sharedBoardFingerprint(local[i]));
}

/** Three-way item merge: edit wins against concurrent delete; an unchanged
 * item does NOT resurrect a deliberate deletion. Same-item edit uses local. */
function mergeThreeWay<T extends { id: string }>(base: T[], local: T[], remote: T[], signature: (item: T) => string = fingerprint): T[] {
  const previous = new Map(base.map(x => [x.id, x]));
  const mine = new Map(local.map(x => [x.id, x]));
  const theirs = new Map(remote.map(x => [x.id, x]));
  const result: T[] = [];
  for (const key of new Set([...remote.map(x => x.id), ...local.map(x => x.id)])) {
    const b = previous.get(key), l = mine.get(key), r = theirs.get(key);
    if (!l) { if (r && (!b || signature(r) !== signature(b))) result.push(r); continue; }
    if (!r) { if (!b || signature(l) !== signature(b)) result.push(l); continue; }
    result.push(!b || signature(l) !== signature(b) ? l : r);
  }
  return result;
}

export function mergeWorkspaceBoards(base: MergeableBoard[], local: MergeableBoard[], remote: MergeableBoard[]): MergeableBoard[] {
  const kept = mergeThreeWay(base, local, remote, sharedBoardFingerprint);
  return kept.map(board => {
    const b = base.find(x => x.id === board.id), l = local.find(x => x.id === board.id), r = remote.find(x => x.id === board.id);
    if (!l || !r) return board;
    const cards = mergeThreeWay(b?.cards ?? [], l.cards, r.cards);
    const ids = new Set(cards.map(x => x.id));
    const metadata = (item: MergeableBoard) => {
      const { cards: _cards, edges: _edges, view: _view, ...rest } = item;
      return JSON.stringify(rest);
    };
    const chosen = !b || metadata(l) !== metadata(b) ? l : r;
    return { ...r, ...chosen, cards, edges: mergeThreeWay(b?.edges ?? [], l.edges, r.edges).filter(e => ids.has(e.from) && ids.has(e.to)) };
  });
}
