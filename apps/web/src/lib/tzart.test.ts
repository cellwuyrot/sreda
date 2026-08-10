/**
 * Тесты: src/lib/tzart.ts — ядро TZartstation.
 *
 * Редактор отличается от прежнего «Рисунка» тем, что всё нарисованное остаётся
 * объектом: его двигают, крутят, растягивают и раскладывают по слоям уже после
 * того, как нарисовали. Каждая из этих возможностей ломается тихо — на экране
 * просто «не выделяется», «уползает» или «не рисуется», без единой ошибки в
 * консоли. Поэтому проверяется:
 *
 *   • попадание курсора — по повёрнутой фигуре, по линии с вырожденной рамкой и
 *     по мазку кисти, у которого рамка охватывает пустоту между витками;
 *   • растягивание за угол — противоположный угол обязан остаться на месте, в
 *     том числе у повёрнутого объекта;
 *   • слои — порядок отрисовки, скрытие и запирание;
 *   • разбор сцены — она приходит из состояния среды, которое на общем холсте
 *     пишет другой участник.
 */
import { describe, it, expect } from "vitest";
import {
  BASE_LAYER_ID,
  DEFAULT_SCENE,
  MAX_CANVAS,
  MAX_LAYERS,
  MAX_POINTS,
  MAX_SHAPES,
  MIN_CANVAS,
  MIN_SHAPE_SIZE,
  addLayer,
  addShape,
  alignShapes,
  appendPoint,
  assignToLayer,
  boundsOf,
  boundsOfMany,
  bringToFront,
  canEditShape,
  defaultLayers,
  distributeShapes,
  duplicateShapes,
  effectiveOpacity,
  handlePoint,
  hitTest,
  isArtColor,
  isDrawn,
  isSafeImageSrc,
  moveLayer,
  moveShape,
  moveShapes,
  orderedShapes,
  parseScene,
  patchLayer,
  pickShape,
  pointsToPath,
  removeLayer,
  removeShape,
  removeShapes,
  replaceShape,
  resizeShape,
  rotateShapeTo,
  safeColor,
  sceneFromImage,
  sendToBack,
  shapesInRect,
  stepOrder,
  visibleShapes,
  type ArtScene,
  type ArtShape,
} from "@/lib/tzart";

function shape(over: Partial<ArtShape> = {}): ArtShape {
  return { id: "s1", kind: "rect", x: 10, y: 10, w: 100, h: 50, ...over };
}

function sceneWith(shapes: ArtShape[], layers = defaultLayers()): ArtScene {
  return { ...DEFAULT_SCENE, layers, shapes };
}

/** Насколько точка близка к ожидаемой — сравнение с допуском на дробную часть. */
function near(actual: number, expected: number, tolerance = 0.01): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

describe("цвет и адрес картинки", () => {
  it("принимается только настоящий цвет", () => {
    expect(isArtColor("#fff")).toBe(true);
    expect(isArtColor("#A1B2C3")).toBe(true);
    expect(isArtColor("red")).toBe(false);
    expect(isArtColor("")).toBe(false);
  });

  it("ИНВАРИАНТ: в цвет нельзя подсунуть ссылку наружу", () => {
    /* Значение уходит в атрибут SVG. Свободная строка там — это `url(...)` с
       обращением на чужой сервер, а сцену на общем холсте пишет кто угодно. */
    for (const bad of ["url(http://evil.tld/x)", "javascript:alert(1)", "#fff;background:url(x)", "#gggggg"]) {
      expect(isArtColor(bad), bad).toBe(false);
    }
    expect(safeColor("url(evil)", "#000000")).toBe("#000000");
  });

  it("ИНВАРИАНТ: картинка берётся только из своего хранилища", () => {
    /* Иначе открытие холста тихо стучится на посторонний сервер: тот узнаёт и
       адрес страницы, и когда именно её смотрели. */
    expect(isSafeImageSrc("/uploads/workspace/a1.png")).toBe(true);
    for (const bad of [
      "https://evil.tld/pixel.gif",
      "//evil.tld/x.png",
      "/uploads/../../etc/passwd",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
    ]) {
      expect(isSafeImageSrc(bad), bad).toBe(false);
    }
  });
});

describe("рисование в любую сторону", () => {
  it("ФИКСАЦИЯ: рамка, нарисованная вверх-влево, становится положительной", () => {
    /* Прямоугольник с отрицательной шириной SVG не рисует вовсе: человек тянет
       мышь влево и видит, что «ничего не создалось». */
    expect(boundsOf(shape({ x: 100, y: 100, w: -60, h: -40 }))).toEqual({ x: 40, y: 60, w: 60, h: 40 });
  });

  it("ИНВАРИАНТ: у линии и стрелки направление не переворачивается", () => {
    /* Для стрелки направление — это смысл, а не оформление: развернув её при
       нормализации, мы показали бы не туда. */
    const arrow = shape({ kind: "arrow", x: 100, y: 100, w: -60, h: -40 });
    expect(arrow.w).toBe(-60);
    expect(boundsOf(arrow)).toEqual({ x: 40, y: 60, w: 60, h: 40 });
  });

  it("случайный щелчок не создаёт фигуру", () => {
    expect(isDrawn(shape({ w: 1, h: 1 }))).toBe(false);
    expect(isDrawn(shape({ w: MIN_SHAPE_SIZE, h: MIN_SHAPE_SIZE }))).toBe(true);
    // Надпись — исключение: она и создаётся щелчком.
    expect(isDrawn(shape({ kind: "text", w: 0, h: 0 }))).toBe(true);
    // Мазок из одной точки — тоже случайный щелчок.
    expect(isDrawn(shape({ kind: "path", points: [1, 1] }))).toBe(false);
  });
});

describe("попадание курсора", () => {
  it("внутрь фигуры — да, далеко снаружи — нет", () => {
    const rect = shape();
    expect(hitTest(rect, 50, 30)).toBe(true);
    expect(hitTest(rect, 500, 500)).toBe(false);
  });

  it("ИНВАРИАНТ: в горизонтальную линию можно попасть мышью", () => {
    /* У неё рамка нулевой высоты. Без запаса на толщину выбрать её было бы
       невозможно — курсор обязан попасть в математически тонкий отрезок. */
    const line = shape({ kind: "line", x: 0, y: 100, w: 200, h: 0, strokeWidth: 2 });
    expect(hitTest(line, 100, 100)).toBe(true);
    expect(hitTest(line, 100, 103)).toBe(true);
    expect(hitTest(line, 100, 140)).toBe(false);
  });

  it("ИНВАРИАНТ: щелчок в пустоте внутри мазка кисти его не выделяет", () => {
    /* Рамка размашистого росчерка охватывает пол-холста. Считай мы попадание по
       рамке — мазок перехватывал бы щелчки по всему, что под ним лежит. */
    const stroke = shape({ kind: "path", points: [0, 0, 200, 0, 200, 200], strokeWidth: 2 });
    expect(hitTest(stroke, 100, 0)).toBe(true); // на самой линии
    expect(hitTest(stroke, 40, 150)).toBe(false); // внутри рамки, но мимо линии
  });

  it("ИНВАРИАНТ: повёрнутую фигуру ловим по её собственным границам", () => {
    /* Узкая полоса, положенная набок. Точка, которая была бы внутри неповёрнутой
       рамки, после поворота оказывается снаружи фигуры — и наоборот. */
    const bar = shape({ x: 0, y: 90, w: 200, h: 20, rotation: 90, strokeWidth: 1 });
    expect(hitTest(bar, 100, 180)).toBe(true); // вдоль новой, вертикальной оси
    expect(hitTest(bar, 190, 100)).toBe(false); // там, где полоса была до поворота
  });

  it("ФИКСАЦИЯ: щелчок по наложенным фигурам берёт верхнюю", () => {
    const scene = sceneWith([shape({ id: "нижняя" }), shape({ id: "верхняя" })]);
    expect(pickShape(scene, 50, 30)?.id).toBe("верхняя");
  });

  it("мимо всех — ничего", () => {
    expect(pickShape(sceneWith([shape()]), 900, 900)).toBeNull();
  });

  it("рамка выделения берёт всё, чего коснулась", () => {
    const scene = sceneWith([shape({ id: "a" }), shape({ id: "b", x: 400, y: 400, w: 50, h: 50 })]);
    expect(shapesInRect(scene, { x: 0, y: 0, w: 200, h: 200 }).map((s) => s.id)).toEqual(["a"]);
    expect(shapesInRect(scene, { x: 0, y: 0, w: 500, h: 500 })).toHaveLength(2);
  });

  it("рамка, протянутая справа налево, работает так же", () => {
    /* Отрицательные ширина и высота — обычное дело: выделяют в обе стороны. */
    const scene = sceneWith([shape({ id: "a" })]);
    expect(shapesInRect(scene, { x: 200, y: 200, w: -200, h: -200 })).toHaveLength(1);
  });
});

describe("растягивание за ручку", () => {
  it("ИНВАРИАНТ: противоположный угол остаётся на месте", () => {
    /* Главное правило, без которого фигура «уползает» из-под курсора при каждом
       растягивании. */
    const rect = shape({ x: 100, y: 100, w: 200, h: 100 });
    const resized = resizeShape(rect, "se", 400, 350);
    expect(resized).toMatchObject({ x: 100, y: 100, w: 300, h: 250 });

    const fromCorner = resizeShape(rect, "nw", 50, 50);
    const b = boundsOf(fromCorner);
    expect(near(b.x + b.w, 300)).toBe(true); // правый край не сдвинулся
    expect(near(b.y + b.h, 200)).toBe(true); // нижний тоже
  });

  it("ИНВАРИАНТ: у повёрнутой фигуры якорь тоже не двигается", () => {
    /* С поворотом это перестаёт быть вычитанием координат: якорь считается уже
       в мировых координатах, после поворота вокруг нового центра. */
    const rect = shape({ x: 100, y: 100, w: 200, h: 100, rotation: 30 });
    const before = handlePoint(rect, "nw");
    const after = handlePoint(resizeShape(rect, "se", 380, 260), "nw");
    expect(near(after.x, before.x, 0.5) && near(after.y, before.y, 0.5)).toBe(true);
  });

  it("фигура не выворачивается наизнанку", () => {
    /* Протащили правую ручку далеко влево — ширина обязана остаться
       положительной, иначе фигура схлопывается и больше не выделяется. */
    const resized = resizeShape(shape({ x: 100, y: 100, w: 200, h: 100 }), "e", -500, 150);
    expect(resized.w).toBeGreaterThan(0);
  });

  it("с сохранением пропорций стороны меняются вместе", () => {
    const resized = resizeShape(shape({ x: 0, y: 0, w: 200, h: 100 }), "se", 400, 110, true);
    expect(near(resized.w / resized.h, 2, 0.001)).toBe(true);
  });

  it("мазок кисти и линия за ручки не тянутся", () => {
    /* Их форму задают точки и концы, а не рамка: растягивание рамки означало бы
       молчаливую потерю формы. */
    const stroke = shape({ kind: "path", points: [0, 0, 10, 10] });
    expect(resizeShape(stroke, "se", 500, 500)).toBe(stroke);
    const line = shape({ kind: "line", w: 50, h: 50 });
    expect(resizeShape(line, "se", 500, 500)).toBe(line);
  });
});

describe("поворот", () => {
  it("курсор прямо над центром — это ноль градусов", () => {
    /* Ноль вверх: снимок с углом 0 выглядит ровно так, как его вставили. */
    const rotated = rotateShapeTo(shape({ x: 0, y: 0, w: 100, h: 100 }), 50, -100);
    expect(rotated.rotation).toBe(0);
  });

  it("курсор справа — четверть оборота", () => {
    expect(rotateShapeTo(shape({ x: 0, y: 0, w: 100, h: 100 }), 500, 50).rotation).toBe(90);
  });

  it("с привязкой угол липнет к пятнадцати градусам", () => {
    /* Поймать ровные 90° мышью иначе практически невозможно. */
    const rotated = rotateShapeTo(shape({ x: 0, y: 0, w: 100, h: 100 }), 500, 60, true);
    expect(rotated.rotation! % 15).toBe(0);
  });
});

describe("правка сцены", () => {
  const scene = sceneWith([shape({ id: "a" }), shape({ id: "b" })]);

  it("сдвиг не меняет исходную фигуру", () => {
    const original = shape();
    expect(moveShape(original, 10, 20)).toMatchObject({ x: 20, y: 30 });
    expect(original).toMatchObject({ x: 10, y: 10 });
  });

  it("ФИКСАЦИЯ: у мазка кисти при сдвиге едут и точки", () => {
    /* Иначе рамка уезжает, а сам росчерк остаётся на месте: объект перестаёт
       совпадать сам с собой. */
    const moved = moveShape(shape({ kind: "path", points: [0, 0, 10, 10] }), 5, 7);
    expect(moved.points).toEqual([5, 7, 15, 17]);
  });

  it("замена и удаление работают по идентификатору", () => {
    expect(replaceShape(scene, shape({ id: "a", w: 999 })).shapes[0]).toMatchObject({ w: 999 });
    expect(removeShape(scene, "a").shapes.map((s) => s.id)).toEqual(["b"]);
    expect(removeShapes(scene, ["a", "b"]).shapes).toEqual([]);
  });

  it("порядок наложения меняется явными действиями", () => {
    expect(bringToFront(scene, "a").shapes.map((s) => s.id)).toEqual(["b", "a"]);
    expect(sendToBack(scene, "b").shapes.map((s) => s.id)).toEqual(["b", "a"]);
    expect(stepOrder(scene, "a", 1).shapes.map((s) => s.id)).toEqual(["b", "a"]);
    // За край — ничего не происходит, а не «пропадает».
    expect(stepOrder(scene, "a", -1).shapes.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("ФИКСАЦИЯ: сверх предела фигуры не добавляются", () => {
    /* Сцена живёт в состоянии среды: без предела одна карточка утащила бы за
       собой всю рабочую среду. */
    const full = sceneWith(Array.from({ length: MAX_SHAPES }, (_, i) => shape({ id: `s${i}` })));
    expect(addShape(full, shape({ id: "лишняя" })).shapes.length).toBe(MAX_SHAPES);
  });

  it("ФИКСАЦИЯ: копия появляется со смещением", () => {
    /* Копия ровно поверх оригинала выглядит как «ничего не произошло», и человек
       жмёт ещё раз, получая стопку невидимых дубликатов. */
    let counter = 0;
    const result = duplicateShapes(scene, ["a"], () => `копия${++counter}`);
    expect(result.ids).toEqual(["копия1"]);
    const copy = result.scene.shapes.find((s) => s.id === "копия1")!;
    expect(copy.x).toBeGreaterThan(10);
    expect(result.scene.shapes).toHaveLength(3);
  });
});

describe("выравнивание", () => {
  const scene = sceneWith([
    shape({ id: "a", x: 0, y: 0, w: 100, h: 100 }),
    shape({ id: "b", x: 200, y: 50, w: 100, h: 100 }),
    shape({ id: "c", x: 500, y: 20, w: 100, h: 100 }),
  ]);

  it("по левому краю все встают в одну линию", () => {
    const aligned = alignShapes(scene, ["a", "b", "c"], "left");
    expect(aligned.shapes.map((s) => boundsOf(s).x)).toEqual([0, 0, 0]);
  });

  it("одинокий объект к краю полотна не уезжает", () => {
    /* Выравнивать не по чему — молча подвинуть единственный объект было бы
       неожиданностью. */
    expect(alignShapes(scene, ["a"], "right")).toBe(scene);
  });

  it("раскладка даёт равные промежутки между центрами", () => {
    const spread = distributeShapes(scene, ["a", "b", "c"], "x");
    const centers = ["a", "b", "c"]
      .map((id) => spread.shapes.find((s) => s.id === id)!)
      .map((s) => boundsOf(s).x + boundsOf(s).w / 2)
      .sort((p, q) => p - q);
    expect(near(centers[1]! - centers[0]!, centers[2]! - centers[1]!)).toBe(true);
  });

  it("двум объектам раскладывать нечего", () => {
    expect(distributeShapes(scene, ["a", "b"], "x")).toBe(scene);
  });
});

describe("слои", () => {
  const layers = [
    { id: "низ", name: "Низ", visible: true, locked: false, opacity: 1 },
    { id: "верх", name: "Верх", visible: true, locked: false, opacity: 1 },
  ];
  const scene = sceneWith(
    [shape({ id: "наверху", layerId: "верх" }), shape({ id: "внизу", layerId: "низ" })],
    layers,
  );

  it("ИНВАРИАНТ: порядок слоёв важнее порядка внутри массива", () => {
    /* Объект нижнего слоя, добавленный последним, обязан остаться под верхним
       слоем — иначе слои не значат ничего. */
    expect(orderedShapes(scene).map((s) => s.id)).toEqual(["внизу", "наверху"]);
    expect(pickShape(scene, 50, 30)?.id).toBe("наверху");
  });

  it("скрытый слой не рисуется и не ловит курсор", () => {
    const hidden = patchLayer(scene, "верх", { visible: false });
    expect(visibleShapes(hidden).map((s) => s.id)).toEqual(["внизу"]);
    expect(pickShape(hidden, 50, 30)?.id).toBe("внизу");
  });

  it("ИНВАРИАНТ: запертый слой видно, но выделить и сдвинуть нельзя", () => {
    /* Ради этого слои и запирают: подложку видно, но она не мешается под
       курсором. */
    const locked = patchLayer(scene, "верх", { locked: true });
    expect(visibleShapes(locked)).toHaveLength(2);
    expect(pickShape(locked, 50, 30)?.id).toBe("внизу");
    expect(canEditShape(locked, locked.shapes[0]!)).toBe(false);
    expect(moveShapes(locked, ["наверху"], 50, 50).shapes[0]).toMatchObject({ x: 10 });
    expect(removeShapes(locked, ["наверху"]).shapes).toHaveLength(2);
  });

  it("прозрачность слоя перемножается с прозрачностью объекта", () => {
    const dim = patchLayer(scene, "верх", { opacity: 0.5 });
    const target = dim.shapes.find((s) => s.id === "наверху")!;
    expect(effectiveOpacity(dim, { ...target, opacity: 0.5 })).toBe(0.25);
  });

  it("удаление слоя уносит его содержимое", () => {
    const without = removeLayer(scene, "верх");
    expect(without.layers.map((l) => l.id)).toEqual(["низ"]);
    expect(without.shapes.map((s) => s.id)).toEqual(["внизу"]);
  });

  it("ИНВАРИАНТ: последний слой удалить нельзя", () => {
    /* Сцена без слоёв — состояние, из которого нельзя ничего нарисовать, и
       человеку пришлось бы догадаться создать слой. */
    const single = sceneWith([shape()]);
    expect(removeLayer(single, single.layers[0]!.id)).toBe(single);
  });

  it("слои переставляются и не выпадают за край", () => {
    expect(moveLayer(scene, "низ", 1).layers.map((l) => l.id)).toEqual(["верх", "низ"]);
    expect(moveLayer(scene, "низ", -1)).toBe(scene);
  });

  it("объект переносится на другой слой", () => {
    const moved = assignToLayer(scene, ["внизу"], "верх");
    expect(moved.shapes.find((s) => s.id === "внизу")!.layerId).toBe("верх");
  });

  it("сверх предела слои не добавляются", () => {
    let full = sceneWith([]);
    for (let i = 0; i < MAX_LAYERS + 5; i++) full = addLayer(full, `l${i}`);
    expect(full.layers.length).toBe(MAX_LAYERS);
  });

  it("объект без слоя считается нижним", () => {
    /* Так читаются сцены, созданные до появления слоёв. */
    const legacy = sceneWith([shape({ id: "старый" })], layers);
    expect(canEditShape(legacy, legacy.shapes[0]!)).toBe(true);
    expect(orderedShapes(legacy).map((s) => s.id)).toEqual(["старый"]);
  });

  it("общая рамка выделения считается по всем объектам", () => {
    expect(boundsOfMany([])).toBeNull();
    expect(boundsOfMany([shape({ x: 0, y: 0, w: 10, h: 10 }), shape({ x: 90, y: 90, w: 10, h: 10 })])).toEqual({
      x: 0, y: 0, w: 100, h: 100,
    });
  });
});

describe("кисть", () => {
  it("точки ближе двух пикселей не запоминаются", () => {
    /* Указатель шлёт события десятками в секунду: без прореживания секунда
       рисования — сотни точек, которые ничего не добавляют. */
    const started = appendPoint([], 0, 0);
    expect(appendPoint(started, 1, 0)).toBe(started);
    expect(appendPoint(started, 10, 0)).toHaveLength(4);
  });

  it("ФИКСАЦИЯ: длина мазка ограничена", () => {
    let points: number[] = [];
    for (let i = 0; i < MAX_POINTS; i++) points = appendPoint(points, i * 10, 0);
    expect(points.length).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("путь строится по точкам, а на пустых не падает", () => {
    expect(pointsToPath([0, 0, 10, 10])).toBe("M 0 0 L 10 10");
    expect(pointsToPath(undefined)).toBe("");
    expect(pointsToPath([])).toBe("");
  });
});

describe("разбор сцены из состояния", () => {
  it("нормальная сцена читается как есть", () => {
    const parsed = parseScene({ w: 800, h: 600, layers: defaultLayers(), shapes: [shape({ fill: "#ff0000" })] });
    expect(parsed.w).toBe(800);
    expect(parsed.shapes[0]).toMatchObject({ id: "s1", kind: "rect", fill: "#ff0000" });
  });

  it("ФИКСАЦИЯ: сцена без слоёв читается как один нижний слой", () => {
    /* Карточки, созданные до появления слоёв, обязаны открываться. */
    const parsed = parseScene({ w: 640, h: 420, shapes: [shape()] });
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0]!.id).toBe(BASE_LAYER_ID);
    expect(canEditShape(parsed, parsed.shapes[0]!)).toBe(true);
  });

  it("ИНВАРИАНТ: неизвестный вид фигуры не попадает в разметку", () => {
    /* Сцену на общем холсте пишет другой участник, а состояние в принципе
       правится снаружи. */
    const parsed = parseScene({ shapes: [{ id: "x", kind: "script" }, shape()] });
    expect(parsed.shapes.map((s) => s.id)).toEqual(["s1"]);
  });

  it("ИНВАРИАНТ: картинка с чужим адресом не восстанавливается", () => {
    const parsed = parseScene({
      shapes: [
        { ...shape({ id: "чужая" }), kind: "image", src: "https://evil.tld/pixel.gif" },
        { ...shape({ id: "своя" }), kind: "image", src: "/uploads/workspace/a.png" },
      ],
    });
    expect(parsed.shapes.map((s) => s.id)).toEqual(["своя"]);
  });

  it("мазок без точек отбрасывается", () => {
    /* Пустое место на холсте, которое нельзя ни увидеть, ни выделить. */
    const parsed = parseScene({ shapes: [{ ...shape({ id: "пустой" }), kind: "path" }, shape()] });
    expect(parsed.shapes.map((s) => s.id)).toEqual(["s1"]);
  });

  it("ссылка на несуществующий слой не прячет объект", () => {
    /* Иначе объект остался бы в состоянии, но пропал бы с экрана навсегда. */
    const parsed = parseScene({ layers: defaultLayers(), shapes: [shape({ layerId: "которого-нет" })] });
    expect(parsed.shapes[0]!.layerId).toBeUndefined();
    expect(visibleShapes(parsed)).toHaveLength(1);
  });

  it("нечисловые координаты и чужие цвета отбрасываются", () => {
    const parsed = parseScene({ shapes: [{ ...shape(), x: "тут", fill: "url(evil)" }] });
    expect(parsed.shapes[0]).toMatchObject({ x: 0 });
    expect(parsed.shapes[0]!.fill).toBeUndefined();
  });

  it("размер полотна зажимается в разумные пределы", () => {
    expect(parseScene({ w: 5, h: 999999, shapes: [] })).toMatchObject({ w: MIN_CANVAS, h: MAX_CANVAS });
  });

  it("мусор вместо сцены даёт пустое полотно, а не падение", () => {
    for (const bad of [null, undefined, 42, "сцена", []]) {
      expect(parseScene(bad).shapes).toEqual([]);
      expect(parseScene(bad).layers).toHaveLength(1);
    }
  });

  it("ФИКСАЦИЯ: старая карточка переносится картинкой-подложкой", () => {
    /* Прежние «Рисунок» и «Изображение» хранят PNG и больше ничего. Перенос
       делает картинку подложкой, поверх которой можно рисовать, ничего не
       потеряв. Полотно — по размеру картинки, иначе снимок экрана висел бы в
       углу пустого листа. */
    const scene = sceneFromImage("/uploads/workspace/a.png", 1200, 800);
    expect(scene).toMatchObject({ w: 1200, h: 800 });
    expect(scene.shapes[0]).toMatchObject({ kind: "image", x: 0, y: 0, w: 1200, h: 800 });
    expect(parseScene(scene).shapes).toHaveLength(1);
  });

  it("перенос с чужим адресом даёт пустое полотно, а не битую картинку", () => {
    expect(sceneFromImage("https://evil.tld/x.png", 100, 100).shapes).toEqual([]);
  });

  it("слишком длинная надпись обрезается", () => {
    const parsed = parseScene({ shapes: [shape({ kind: "text", text: "я".repeat(5000) })] });
    expect(parsed.shapes[0]!.text!.length).toBe(500);
  });
});
