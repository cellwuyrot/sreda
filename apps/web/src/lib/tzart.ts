/**
 * TZartstation: редактор изображений рабочей среды.
 *
 * ── Что это заменяет ────────────────────────────────────────────────────────
 *
 * Прежний «Рисунок» рисовал по пикселям: провёл линию — получил картинку.
 * Передвинуть прямоугольник, перекрасить его, поправить надпись после этого уже
 * нельзя, только стереть и нарисовать заново. И каждая правка — это новый PNG
 * целиком: мегабайты в состоянии среды и полная перерисовка при отмене.
 *
 * Здесь всё, что нарисовано, остаётся **объектом**: у фигуры, мазка кисти и
 * вставленной фотографии есть положение, размер, поворот, прозрачность и слой.
 * Их двигают и правят когда угодно, отмена возвращает ровно одно действие, а
 * сцена весит килобайты — байты фотографий лежат в хранилище, в сцене только
 * адрес.
 *
 * ── Слои ────────────────────────────────────────────────────────────────────
 *
 * Как в фотошопе: порядок слоёв задаёт порядок отрисовки, слой можно скрыть,
 * запереть от правки и притушить прозрачностью. Скрытый или запертый слой не
 * ловит курсор — иначе «почему не выделяется» становится главным вопросом к
 * редактору.
 *
 * ── Почему логика отдельно от отрисовки ─────────────────────────────────────
 *
 * Здесь живёт всё, на чём легко ошибиться и что невозможно заметить глазами:
 * попадание курсора в повёрнутую фигуру, растягивание за угол (противоположный
 * угол обязан остаться на месте), нормализация рисования «назад», порядок
 * наложения, проверка цвета и адреса картинки. Компонент рисует и слушает мышь;
 * решения принимает этот модуль, и на каждое есть тест.
 */

/** Виды объектов сцены. path — мазок кисти, image — вставленная картинка. */
export const ART_KINDS = ["rect", "ellipse", "line", "arrow", "text", "path", "image"] as const;
export type ArtKind = (typeof ART_KINDS)[number];

/** Виды, которые рисуются протягиванием мыши (кнопки на панели инструментов). */
export const DRAW_KINDS: ArtKind[] = ["rect", "ellipse", "line", "arrow", "text"];

export interface ArtShape {
  id: string;
  kind: ArtKind;
  /** Слой, которому принадлежит объект. Пусто — нижний слой сцены. */
  layerId?: string;
  /** Левый верхний угол рамки. Для линии и стрелки — начало. */
  x: number;
  y: number;
  /** Размеры рамки. Для линии — смещение до конца, может быть отрицательным. */
  w: number;
  h: number;
  /** Поворот в градусах вокруг центра рамки. */
  rotation?: number;
  /** Непрозрачность самого объекта, 0..1. Со слоем перемножается. */
  opacity?: number;
  /** Заливка. Пусто — без заливки (только контур). */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Только надпись. */
  text?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  /** Только мазок кисти: [x0,y0,x1,y1,…] в координатах сцены. */
  points?: number[];
  /** Только картинка: адрес в хранилище. */
  src?: string;
}

export interface ArtLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1. */
  opacity: number;
}

export interface ArtScene {
  /** Размер полотна. */
  w: number;
  h: number;
  bg?: string;
  /** Снизу вверх: первый слой рисуется первым, последний — поверх всех. */
  layers: ArtLayer[];
  /** Внутри слоя порядок в массиве — порядок наложения: последний сверху. */
  shapes: ArtShape[];
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Нижний слой новой сцены. Тот же идентификатор получают старые сцены без слоёв. */
export const BASE_LAYER_ID = "base";

export function defaultLayers(): ArtLayer[] {
  return [{ id: BASE_LAYER_ID, name: "Слой 1", visible: true, locked: false, opacity: 1 }];
}

/** Полотно по умолчанию. */
export const DEFAULT_SCENE: ArtScene = { w: 960, h: 600, layers: defaultLayers(), shapes: [] };

/** Пределы полотна. */
export const MIN_CANVAS = 160;
export const MAX_CANVAS = 4000;

/** Сколько объектов помещается в одну сцену. */
export const MAX_SHAPES = 500;

/** Сколько слоёв. Больше — панель перестаёт помещаться на экране. */
export const MAX_LAYERS = 20;

/** Объект тоньше этого считается случайным щелчком и не создаётся. */
export const MIN_SHAPE_SIZE = 4;

/** Наименьший размер при растягивании: за нулём фигура схлопнулась бы навсегда. */
export const MIN_RESIZE = 2;

/**
 * Сколько чисел хранит один мазок кисти (пара на точку).
 *
 * Сцена лежит внутри состояния среды, у которого жёсткий предел размера. Без
 * потолка один долгий росчерк мышью — это тысячи точек и мегабайт в JSON.
 */
export const MAX_POINTS = 600;

/** Шаг привязки при повороте с зажатым Shift. */
export const ROTATION_SNAP = 15;

/**
 * Цвет принимается только в виде #rgb или #rrggbb.
 *
 * Значение попадает в атрибут SVG. Свободная строка там — это возможность
 * подсунуть `url(...)` со ссылкой наружу, а сцена приходит из состояния, которое
 * на общем холсте правит кто угодно.
 */
export function isArtColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

/** Цвет или запасной, если пришло что-то другое. */
export function safeColor(value: unknown, fallback: string): string {
  return isArtColor(value) ? value : fallback;
}

/**
 * Адрес картинки: только своё хранилище.
 *
 * Картинка в сцене — это `<image href>`. Чужой адрес там означает, что открытие
 * холста тихо стучится на посторонний сервер: тот узнаёт и адрес страницы, и
 * когда именно её смотрели. На общем холсте сцену пишет другой участник, так что
 * это не теория. Разрешаем только путь внутри своего хранилища.
 */
export function isSafeImageSrc(value: unknown): value is string {
  return typeof value === "string" && /^\/uploads\/[\w./-]+$/.test(value) && !value.includes("..");
}

/** Доля непрозрачности в допустимых пределах. */
export function clampOpacity(value: unknown, fallback = 1): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, n));
}

/* ── Геометрия ─────────────────────────────────────────────────────────────── */

/**
 * Привести рамку к положительным размерам.
 *
 * Рисуют не только слева направо: если тянуть вверх и влево, ширина и высота
 * получаются отрицательными, а прямоугольник с отрицательной шириной в SVG
 * просто не отображается — человек видит, что «ничего не создалось».
 *
 * Линия и стрелка не нормализуются: у них направление — смысл, а не оформление.
 * Стрелка, развёрнутая при нормализации, показывала бы не туда.
 */
export function normalizeBox(shape: ArtShape): ArtShape {
  if (shape.kind === "line" || shape.kind === "arrow") return shape;
  const x = shape.w < 0 ? shape.x + shape.w : shape.x;
  const y = shape.h < 0 ? shape.y + shape.h : shape.y;
  return { ...shape, x, y, w: Math.abs(shape.w), h: Math.abs(shape.h) };
}

/** Достаточно ли объект велик, чтобы его создавать. */
export function isDrawn(shape: ArtShape): boolean {
  if (shape.kind === "text") return true; // надпись создаётся щелчком
  if (shape.kind === "path") return (shape.points?.length ?? 0) >= 4;
  if (shape.kind === "line" || shape.kind === "arrow") {
    return Math.hypot(shape.w, shape.h) >= MIN_SHAPE_SIZE;
  }
  return Math.abs(shape.w) >= MIN_SHAPE_SIZE && Math.abs(shape.h) >= MIN_SHAPE_SIZE;
}

/** Рамка мазка кисти — по крайним точкам. */
export function pathBounds(points: number[] | undefined): Box {
  if (!points || points.length < 2) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const px = points[i]!;
    const py = points[i + 1]!;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Прямоугольник, в который помещается объект (без учёта поворота). */
export function boundsOf(shape: ArtShape): Box {
  if (shape.kind === "path") return pathBounds(shape.points);
  if (shape.kind === "line" || shape.kind === "arrow") {
    return {
      x: Math.min(shape.x, shape.x + shape.w),
      y: Math.min(shape.y, shape.y + shape.h),
      w: Math.abs(shape.w),
      h: Math.abs(shape.h),
    };
  }
  const box = normalizeBox(shape);
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

/** Центр рамки — вокруг него крутится поворот. */
export function centerOf(shape: ArtShape): { x: number; y: number } {
  const b = boundsOf(shape);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Повернуть точку вокруг центра на угол в градусах. */
export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  degrees: number,
): { x: number; y: number } {
  if (!degrees) return { x: px, y: py };
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Расстояние от точки до отрезка. Нужно попаданию в мазок кисти и в линию. */
function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Попал ли курсор в объект.
 *
 * Три отдельных случая, и каждый ломается по-своему:
 *
 *   • у линии рамка бывает вырожденной (горизонтальная линия — нулевой высоты),
 *     поэтому попадание считается с запасом в толщину линии;
 *   • у мазка кисти рамка охватывает весь росчерк, и по рамке в него попадал бы
 *     любой щелчок в пустоте между витками — считаем расстояние до самих
 *     отрезков;
 *   • у повёрнутого объекта рамка в мировых координатах не совпадает с самим
 *     объектом — сначала возвращаем курсор в его собственную систему.
 */
export function hitTest(shape: ArtShape, px: number, py: number): boolean {
  const pad = Math.max(6, (shape.strokeWidth ?? 2) * 2);

  if (shape.rotation) {
    const c = centerOf(shape);
    const local = rotatePoint(px, py, c.x, c.y, -shape.rotation);
    return hitTest({ ...shape, rotation: 0 }, local.x, local.y);
  }

  if (shape.kind === "path") {
    const points = shape.points ?? [];
    for (let i = 0; i + 3 < points.length; i += 2) {
      if (distanceToSegment(px, py, points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!) <= pad) {
        return true;
      }
    }
    return false;
  }

  if (shape.kind === "line" || shape.kind === "arrow") {
    return distanceToSegment(px, py, shape.x, shape.y, shape.x + shape.w, shape.y + shape.h) <= pad;
  }

  const b = boundsOf(shape);
  return px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad;
}

/* ── Слои ──────────────────────────────────────────────────────────────────── */

/** Слой объекта: пустое поле означает нижний слой сцены. */
export function shapeLayerId(scene: ArtScene, shape: ArtShape): string {
  const first = scene.layers[0]?.id ?? BASE_LAYER_ID;
  if (!shape.layerId) return first;
  return scene.layers.some((l) => l.id === shape.layerId) ? shape.layerId : first;
}

export function layerById(scene: ArtScene, id: string): ArtLayer | null {
  return scene.layers.find((l) => l.id === id) ?? null;
}

/** Можно ли править объект: слой виден и не заперт. */
export function canEditShape(scene: ArtScene, shape: ArtShape): boolean {
  const layer = layerById(scene, shapeLayerId(scene, shape));
  return !!layer && layer.visible && !layer.locked;
}

/**
 * Объекты в порядке отрисовки: сначала нижний слой, внутри слоя — порядок
 * массива. Именно этот порядок задаёт, что поверх чего лежит.
 */
export function orderedShapes(scene: ArtScene): ArtShape[] {
  const out: ArtShape[] = [];
  for (const layer of scene.layers) {
    for (const shape of scene.shapes) {
      if (shapeLayerId(scene, shape) === layer.id) out.push(shape);
    }
  }
  return out;
}

/** То же, но без скрытых слоёв — это и рисуется на экране. */
export function visibleShapes(scene: ArtScene): ArtShape[] {
  return orderedShapes(scene).filter((s) => layerById(scene, shapeLayerId(scene, s))?.visible !== false);
}

/** Итоговая непрозрачность: своя, помноженная на слой. */
export function effectiveOpacity(scene: ArtScene, shape: ArtShape): number {
  const layer = layerById(scene, shapeLayerId(scene, shape));
  return clampOpacity(shape.opacity) * clampOpacity(layer?.opacity);
}

/**
 * Верхний объект под курсором.
 *
 * Идём с конца порядка отрисовки: последний нарисован поверх остальных, и
 * выбирать нужно именно его. Скрытые и запертые слои пропускаем — щелчок обязан
 * доставать то, что человек видит и может править.
 */
export function pickShape(scene: ArtScene, px: number, py: number): ArtShape | null {
  const ordered = orderedShapes(scene);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const shape = ordered[i]!;
    if (!canEditShape(scene, shape)) continue;
    if (hitTest(shape, px, py)) return shape;
  }
  return null;
}

/** Объекты, попавшие в рамку выделения (пересечение, а не полное вхождение). */
export function shapesInRect(scene: ArtScene, rect: Box): ArtShape[] {
  const x1 = Math.min(rect.x, rect.x + rect.w);
  const y1 = Math.min(rect.y, rect.y + rect.h);
  const x2 = x1 + Math.abs(rect.w);
  const y2 = y1 + Math.abs(rect.h);
  return orderedShapes(scene).filter((shape) => {
    if (!canEditShape(scene, shape)) return false;
    const b = boundsOf(shape);
    return b.x <= x2 && b.x + b.w >= x1 && b.y <= y2 && b.y + b.h >= y1;
  });
}

/** Общая рамка нескольких объектов. Пусто — null, а не рамка нулевого размера. */
export function boundsOfMany(shapes: ArtShape[]): Box | null {
  if (shapes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    const b = boundsOf(shape);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ── Правка сцены ──────────────────────────────────────────────────────────── */

/** Сдвинуть объект. Возвращается новый: сцена неизменяема. */
export function moveShape(shape: ArtShape, dx: number, dy: number): ArtShape {
  const moved: ArtShape = { ...shape, x: shape.x + dx, y: shape.y + dy };
  if (shape.kind === "path" && shape.points) {
    moved.points = shape.points.map((value, i) => (i % 2 === 0 ? value + dx : value + dy));
  }
  return moved;
}

export function replaceShape(scene: ArtScene, next: ArtShape): ArtScene {
  return { ...scene, shapes: scene.shapes.map((s) => (s.id === next.id ? next : s)) };
}

export function replaceShapes(scene: ArtScene, next: ArtShape[]): ArtScene {
  const map = new Map(next.map((s) => [s.id, s]));
  return { ...scene, shapes: scene.shapes.map((s) => map.get(s.id) ?? s) };
}

/** Сдвинуть сразу несколько объектов — перетаскивание выделенной группы. */
export function moveShapes(scene: ArtScene, ids: string[], dx: number, dy: number): ArtScene {
  const set = new Set(ids);
  return {
    ...scene,
    shapes: scene.shapes.map((s) => (set.has(s.id) && canEditShape(scene, s) ? moveShape(s, dx, dy) : s)),
  };
}

export function removeShape(scene: ArtScene, id: string): ArtScene {
  return { ...scene, shapes: scene.shapes.filter((s) => s.id !== id) };
}

export function removeShapes(scene: ArtScene, ids: string[]): ArtScene {
  const set = new Set(ids);
  return { ...scene, shapes: scene.shapes.filter((s) => !set.has(s.id) || !canEditShape(scene, s)) };
}

/** Добавить объект наверх. Сверх предела — не добавляем. */
export function addShape(scene: ArtScene, shape: ArtShape): ArtScene {
  if (scene.shapes.length >= MAX_SHAPES) return scene;
  return { ...scene, shapes: [...scene.shapes, shape] };
}

/**
 * Копия выделенного со смещением.
 *
 * Смещение обязательно: копия ровно поверх оригинала выглядит как «ничего не
 * произошло», и человек жмёт ещё раз, получая стопку невидимых дубликатов.
 */
export function duplicateShapes(
  scene: ArtScene,
  ids: string[],
  makeId: () => string,
  offset = 16,
): { scene: ArtScene; ids: string[] } {
  const set = new Set(ids);
  const copies: ArtShape[] = [];
  for (const shape of orderedShapes(scene)) {
    if (!set.has(shape.id)) continue;
    if (scene.shapes.length + copies.length >= MAX_SHAPES) break;
    copies.push({ ...moveShape(shape, offset, offset), id: makeId() });
  }
  if (copies.length === 0) return { scene, ids: [] };
  return { scene: { ...scene, shapes: [...scene.shapes, ...copies] }, ids: copies.map((c) => c.id) };
}

/** Поднять объект на самый верх своего слоя. */
export function bringToFront(scene: ArtScene, id: string): ArtScene {
  const shape = scene.shapes.find((s) => s.id === id);
  if (!shape) return scene;
  return { ...scene, shapes: [...scene.shapes.filter((s) => s.id !== id), shape] };
}

/** Опустить объект в самый низ своего слоя. */
export function sendToBack(scene: ArtScene, id: string): ArtScene {
  const shape = scene.shapes.find((s) => s.id === id);
  if (!shape) return scene;
  return { ...scene, shapes: [shape, ...scene.shapes.filter((s) => s.id !== id)] };
}

/** Сдвинуть объект на один шаг в порядке наложения. */
export function stepOrder(scene: ArtScene, id: string, direction: 1 | -1): ArtScene {
  const index = scene.shapes.findIndex((s) => s.id === id);
  if (index < 0) return scene;
  const target = index + direction;
  if (target < 0 || target >= scene.shapes.length) return scene;
  const shapes = [...scene.shapes];
  const [moved] = shapes.splice(index, 1);
  shapes.splice(target, 0, moved!);
  return { ...scene, shapes };
}

/* ── Трансформация ─────────────────────────────────────────────────────────── */

/** Точка ручки на рамке (уже с учётом поворота) — за неё тянут мышью. */
export function handlePoint(shape: ArtShape, handle: Handle): { x: number; y: number } {
  const b = boundsOf(shape);
  const x = handle.includes("w") ? b.x : handle.includes("e") ? b.x + b.w : b.x + b.w / 2;
  const y = handle.includes("n") ? b.y : handle.includes("s") ? b.y + b.h : b.y + b.h / 2;
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return rotatePoint(x, y, c.x, c.y, shape.rotation ?? 0);
}

/** Все ручки разом — для отрисовки рамки выделения. */
export function handlePoints(shape: ArtShape): { handle: Handle; x: number; y: number }[] {
  return HANDLES.map((handle) => ({ handle, ...handlePoint(shape, handle) }));
}

/** Ручка, противоположная взятой: именно она обязана остаться на месте. */
function oppositeHandle(handle: Handle): Handle {
  const map: Record<Handle, Handle> = {
    nw: "se", n: "s", ne: "sw", e: "w", se: "nw", s: "n", sw: "ne", w: "e",
  };
  return map[handle];
}

/**
 * Растянуть объект за ручку.
 *
 * Главное правило, которое видно сразу и без которого редактор «уползает»:
 * **противоположный угол остаётся на месте**. Тянешь за правый нижний — левый
 * верхний не двигается. С поворотом это перестаёт быть вычитанием координат:
 * курсор сначала переводится в собственную систему объекта, рамка правится там,
 * а потом вся фигура сдвигается так, чтобы якорь вернулся в прежнюю мировую
 * точку.
 *
 * Мазок кисти и линия не растягиваются за ручки: у первого форму задают точки,
 * у второй — концы. Их правят перемещением.
 */
export function resizeShape(
  shape: ArtShape,
  handle: Handle,
  px: number,
  py: number,
  keepRatio = false,
): ArtShape {
  if (shape.kind === "path" || shape.kind === "line" || shape.kind === "arrow") return shape;

  const rotation = shape.rotation ?? 0;
  const b = boundsOf(shape);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const local = rotatePoint(px, py, c.x, c.y, -rotation);

  let left = b.x;
  let top = b.y;
  let right = b.x + b.w;
  let bottom = b.y + b.h;

  if (handle.includes("w")) left = Math.min(local.x, right - MIN_RESIZE);
  if (handle.includes("e")) right = Math.max(local.x, left + MIN_RESIZE);
  if (handle.includes("n")) top = Math.min(local.y, bottom - MIN_RESIZE);
  if (handle.includes("s")) bottom = Math.max(local.y, top + MIN_RESIZE);

  let w = right - left;
  let h = bottom - top;

  /* С зажатым Shift пропорции сохраняются — иначе фотографию невозможно
     увеличить, не сплющив. */
  if (keepRatio && b.w > 0 && b.h > 0 && handle.length === 2) {
    const ratio = b.w / b.h;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    if (handle.includes("w")) left = right - w;
    if (handle.includes("n")) top = bottom - h;
  }

  const anchor = oppositeHandle(handle);
  const anchorWorld = handlePoint(shape, anchor);

  const next: ArtShape = { ...shape, x: left, y: top, w, h };
  const nextAnchor = handlePoint(next, anchor);
  return { ...next, x: left + (anchorWorld.x - nextAnchor.x), y: top + (anchorWorld.y - nextAnchor.y) };
}

/**
 * Повернуть объект так, чтобы он «смотрел» на курсор.
 *
 * Ноль — вверх: это привычное направление, и снимок с углом 0 выглядит ровно
 * так, как его вставили. С зажатым Shift угол липнет к шагу в 15°, иначе поймать
 * ровные 90° мышью практически невозможно.
 */
export function rotateShapeTo(shape: ArtShape, px: number, py: number, snap = false): ArtShape {
  const c = centerOf(shape);
  let degrees = (Math.atan2(py - c.y, px - c.x) * 180) / Math.PI + 90;
  if (snap) degrees = Math.round(degrees / ROTATION_SNAP) * ROTATION_SNAP;
  degrees = ((degrees % 360) + 360) % 360;
  return { ...shape, rotation: Math.round(degrees * 10) / 10 };
}

/* ── Выравнивание ──────────────────────────────────────────────────────────── */

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/**
 * Выровнять выделенные объекты по общей рамке.
 *
 * Меньше двух объектов — выравнивать не по чему, возвращаем сцену как есть:
 * молча подвинуть единственный объект к краю полотна было бы неожиданностью.
 */
export function alignShapes(scene: ArtScene, ids: string[], mode: AlignMode): ArtScene {
  const set = new Set(ids);
  const targets = scene.shapes.filter((s) => set.has(s.id) && canEditShape(scene, s));
  const box = boundsOfMany(targets);
  if (!box || targets.length < 2) return scene;

  const moved = targets.map((shape) => {
    const b = boundsOf(shape);
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = box.x - b.x;
    if (mode === "right") dx = box.x + box.w - (b.x + b.w);
    if (mode === "hcenter") dx = box.x + box.w / 2 - (b.x + b.w / 2);
    if (mode === "top") dy = box.y - b.y;
    if (mode === "bottom") dy = box.y + box.h - (b.y + b.h);
    if (mode === "vcenter") dy = box.y + box.h / 2 - (b.y + b.h / 2);
    return moveShape(shape, dx, dy);
  });

  return replaceShapes(scene, moved);
}

/**
 * Разложить объекты с равными промежутками между центрами.
 *
 * Меньше трёх — раскладывать нечего: у двух объектов промежуток один и он уже
 * равномерный.
 */
export function distributeShapes(scene: ArtScene, ids: string[], axis: "x" | "y"): ArtScene {
  const set = new Set(ids);
  const targets = scene.shapes.filter((s) => set.has(s.id) && canEditShape(scene, s));
  if (targets.length < 3) return scene;

  const withCenter = targets
    .map((shape) => {
      const b = boundsOf(shape);
      return { shape, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
    })
    .sort((a, b) => (axis === "x" ? a.cx - b.cx : a.cy - b.cy));

  const first = withCenter[0]!;
  const last = withCenter[withCenter.length - 1]!;
  const from = axis === "x" ? first.cx : first.cy;
  const to = axis === "x" ? last.cx : last.cy;
  const step = (to - from) / (withCenter.length - 1);

  const moved = withCenter.map((item, i) => {
    const target = from + step * i;
    const delta = target - (axis === "x" ? item.cx : item.cy);
    return axis === "x" ? moveShape(item.shape, delta, 0) : moveShape(item.shape, 0, delta);
  });

  return replaceShapes(scene, moved);
}

/* ── Слои: правка ──────────────────────────────────────────────────────────── */

export function addLayer(scene: ArtScene, id: string, name?: string): ArtScene {
  if (scene.layers.length >= MAX_LAYERS) return scene;
  const layer: ArtLayer = {
    id,
    name: name || `Слой ${scene.layers.length + 1}`,
    visible: true,
    locked: false,
    opacity: 1,
  };
  return { ...scene, layers: [...scene.layers, layer] };
}

/**
 * Удалить слой вместе с его содержимым.
 *
 * Последний слой не удаляется: сцена без слоёв — это состояние, из которого
 * нельзя ничего нарисовать, и человеку пришлось бы догадаться создать слой.
 */
export function removeLayer(scene: ArtScene, id: string): ArtScene {
  if (scene.layers.length <= 1) return scene;
  if (!scene.layers.some((l) => l.id === id)) return scene;
  return {
    ...scene,
    layers: scene.layers.filter((l) => l.id !== id),
    shapes: scene.shapes.filter((s) => shapeLayerId(scene, s) !== id),
  };
}

export function patchLayer(scene: ArtScene, id: string, patch: Partial<ArtLayer>): ArtScene {
  return {
    ...scene,
    layers: scene.layers.map((l) =>
      l.id === id
        ? {
            ...l,
            ...patch,
            name: typeof patch.name === "string" ? patch.name.slice(0, 60) : l.name,
            opacity: patch.opacity === undefined ? l.opacity : clampOpacity(patch.opacity),
          }
        : l,
    ),
  };
}

/** Переставить слой на шаг вверх или вниз в порядке отрисовки. */
export function moveLayer(scene: ArtScene, id: string, direction: 1 | -1): ArtScene {
  const index = scene.layers.findIndex((l) => l.id === id);
  if (index < 0) return scene;
  const target = index + direction;
  if (target < 0 || target >= scene.layers.length) return scene;
  const layers = [...scene.layers];
  const [moved] = layers.splice(index, 1);
  layers.splice(target, 0, moved!);
  return { ...scene, layers };
}

/** Перенести объекты на другой слой. */
export function assignToLayer(scene: ArtScene, ids: string[], layerId: string): ArtScene {
  if (!scene.layers.some((l) => l.id === layerId)) return scene;
  const set = new Set(ids);
  return { ...scene, shapes: scene.shapes.map((s) => (set.has(s.id) ? { ...s, layerId } : s)) };
}

/* ── Кисть ─────────────────────────────────────────────────────────────────── */

/**
 * Добавить точку к мазку, если она достаточно далеко от предыдущей.
 *
 * Указатель шлёт события десятками в секунду, и без прореживания секунда
 * рисования — это сотни точек, которые визуально ничего не добавляют, но
 * навсегда остаются в состоянии среды.
 */
export function appendPoint(points: number[], x: number, y: number, minDistance = 2): number[] {
  if (points.length >= MAX_POINTS) return points;
  if (points.length >= 2) {
    const lastX = points[points.length - 2]!;
    const lastY = points[points.length - 1]!;
    if (Math.hypot(x - lastX, y - lastY) < minDistance) return points;
  }
  return [...points, Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

/** Путь SVG для мазка: сглаженная ломаная. */
export function pointsToPath(points: number[] | undefined): string {
  if (!points || points.length < 4) {
    if (!points || points.length < 2) return "";
    return `M ${points[0]} ${points[1]} L ${points[0]} ${points[1]}`;
  }
  let d = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i + 1 < points.length; i += 2) {
    d += ` L ${points[i]} ${points[i + 1]}`;
  }
  return d;
}

/* ── Разбор состояния ──────────────────────────────────────────────────────── */

/**
 * Разбор сцены из карточки.
 *
 * Сцена приходит из общего состояния среды: на групповом холсте её мог записать
 * другой участник, а состояние в принципе правится снаружи. Поэтому здесь не
 * приведение типа, а проверка: неизвестные виды, нечисловые координаты, цвета
 * строкой и чужие адреса картинок отбрасываются, а не попадают в разметку.
 *
 * Старые сцены без слоёв читаются как одна нижняя плоскость — карточки,
 * созданные до появления слоёв, продолжают открываться.
 */
export function parseScene(value: unknown): ArtScene {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SCENE, layers: defaultLayers(), shapes: [] };
  }
  const raw = value as Partial<ArtScene>;

  const layers: ArtLayer[] = [];
  if (Array.isArray(raw.layers)) {
    for (const item of raw.layers.slice(0, MAX_LAYERS)) {
      const layer = parseLayer(item);
      if (layer) layers.push(layer);
    }
  }
  if (layers.length === 0) layers.push(...defaultLayers());

  const known = new Set(layers.map((l) => l.id));
  const shapes: ArtShape[] = [];
  if (Array.isArray(raw.shapes)) {
    for (const item of raw.shapes.slice(0, MAX_SHAPES)) {
      const shape = parseShape(item);
      if (!shape) continue;
      if (shape.layerId && !known.has(shape.layerId)) delete shape.layerId;
      shapes.push(shape);
    }
  }

  return {
    w: clampCanvas(raw.w),
    h: clampCanvas(raw.h, DEFAULT_SCENE.h),
    bg: isArtColor(raw.bg) ? raw.bg : undefined,
    layers,
    shapes,
  };
}

function clampCanvas(value: unknown, fallback = DEFAULT_SCENE.w): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(MAX_CANVAS, Math.max(MIN_CANVAS, Math.round(n)));
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseLayer(value: unknown): ArtLayer | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ArtLayer>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name ? raw.name.slice(0, 60) : "Слой",
    visible: raw.visible !== false,
    locked: raw.locked === true,
    opacity: clampOpacity(raw.opacity),
  };
}

function parsePoints(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  for (const item of value.slice(0, MAX_POINTS)) {
    if (typeof item !== "number" || !Number.isFinite(item)) return undefined;
    out.push(item);
  }
  /* Нечётная длина — это точка без координаты Y: разбираем как испорченное. */
  return out.length >= 4 && out.length % 2 === 0 ? out : undefined;
}

function parseShape(value: unknown): ArtShape | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ArtShape>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (!ART_KINDS.includes(raw.kind as ArtKind)) return null;

  const kind = raw.kind as ArtKind;

  /* Мазок без точек и картинка без адреса — это пустое место на холсте, которое
     нельзя ни увидеть, ни выделить. Не восстанавливаем. */
  const points = kind === "path" ? parsePoints(raw.points) : undefined;
  if (kind === "path" && !points) return null;
  if (kind === "image" && !isSafeImageSrc(raw.src)) return null;

  const shape: ArtShape = {
    id: raw.id,
    kind,
    x: num(raw.x),
    y: num(raw.y),
    w: num(raw.w),
    h: num(raw.h),
    rotation: raw.rotation === undefined ? undefined : ((num(raw.rotation) % 360) + 360) % 360,
    opacity: raw.opacity === undefined ? undefined : clampOpacity(raw.opacity),
    fill: isArtColor(raw.fill) ? raw.fill : undefined,
    stroke: isArtColor(raw.stroke) ? raw.stroke : undefined,
    strokeWidth: Math.min(80, Math.max(1, num(raw.strokeWidth, 2))),
    text: typeof raw.text === "string" ? raw.text.slice(0, 500) : undefined,
    fontSize: Math.min(200, Math.max(8, num(raw.fontSize, 18))),
    bold: raw.bold === true ? true : undefined,
    italic: raw.italic === true ? true : undefined,
    points,
    src: kind === "image" ? (raw.src as string) : undefined,
  };
  if (typeof raw.layerId === "string" && raw.layerId) shape.layerId = raw.layerId;
  return shape;
}

/**
 * Сцена из готовой картинки — перенос старой карточки в TZartstation.
 *
 * Прежние «Рисунок» и «Изображение» хранят PNG и больше ничего: содержимое в них
 * не правится. Перенос делает картинку подложкой сцены, поверх которой можно
 * рисовать и подписывать, ничего не потеряв. Сам файл не трогается — он остаётся
 * в хранилище, сцена только ссылается на него.
 *
 * Полотно берётся по размеру картинки: так снимок экрана не оказывается
 * обрезанным и не висит в углу пустого листа.
 */
export function sceneFromImage(src: string, width: number, height: number): ArtScene {
  const w = clampCanvas(width);
  const h = clampCanvas(height, DEFAULT_SCENE.h);
  const layers = defaultLayers();
  if (!isSafeImageSrc(src)) return { w, h, layers, shapes: [] };
  return {
    w,
    h,
    layers,
    shapes: [
      {
        id: `sh_${Math.random().toString(36).slice(2, 10)}`,
        kind: "image",
        layerId: layers[0]!.id,
        x: 0,
        y: 0,
        w,
        h,
        src,
      },
    ],
  };
}

/** Во сколько байт обойдётся сцена в состоянии среды. */
export function sceneBytes(scene: ArtScene): number {
  return new TextEncoder().encode(JSON.stringify(scene)).length;
}
