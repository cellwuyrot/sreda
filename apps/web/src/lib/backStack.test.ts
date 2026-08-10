/**
 * Тесты: src/lib/backStack.ts — что считать шагом назад.
 *
 * Зачем это появилось: кнопка «←» вела по постоянному адресу, то есть означала не
 * «назад», а «в такое-то место». Пришёл в настройки уведомлений из панели
 * администратора — и «назад» уносило в мессенджер, хотя вернуться человек хотел
 * туда, откуда пришёл.
 *
 * Здесь проверяется решение, а не переходы: переходы делает маршрутизатор.
 *
 * Вторая правка — от зацикливания. Кнопка решала «есть ли куда идти» по своему
 * следу, а шаг делала историей браузера. Это разные списки: смена раздела
 * настроек меняет только запрос в адресе, в истории запись появляется, в следе
 * нет. История отступала на запись с тем же путём — человек оставался на месте,
 * и выйти из настроек было нельзя. Теперь шаг считается тем же следом, и
 * вернуться на текущий путь нельзя в принципе; это закреплено ниже.
 */
import { describe, it, expect } from "vitest";
import { BACK_STACK_LIMIT, canStepBack, isInAppPath, parseStack, previousPath, recordVisit, stepBack } from "@/lib/backStack";

describe("recordVisit", () => {
  it("первое посещение начинает след", () => {
    expect(recordVisit([], "/connect")).toEqual(["/connect"]);
  });

  it("переход вперёд добавляет шаг", () => {
    expect(recordVisit(["/connect"], "/admin")).toEqual(["/connect", "/admin"]);
  });

  /**
   * ИНВАРИАНТ: возврат назад снимает шаг, а не добавляет новый. Иначе след рос бы
   * от ходьбы туда-обратно, и «назад» перестало бы когда-нибудь заканчиваться.
   */
  it("ИНВАРИАНТ: возврат на предыдущий шаг снимает последний", () => {
    const stack = ["/connect", "/admin", "/admin/vpn"];
    expect(recordVisit(stack, "/admin")).toEqual(["/connect", "/admin"]);
  });

  /**
   * ИНВАРИАНТ: повторное посещение того же пути шагом не считается. Разделы
   * мессенджера различаются параметрами адреса, и без этого одна прогулка по
   * разделам требовала бы десяти нажатий «назад».
   */
  it("ИНВАРИАНТ: тот же путь не удваивается", () => {
    expect(recordVisit(["/connect"], "/connect")).toEqual(["/connect"]);
  });

  it("пустой путь ничего не меняет", () => {
    expect(recordVisit(["/connect"], "")).toEqual(["/connect"]);
  });

  /**
   * ИНВАРИАНТ: след ограничен. «Назад» — про недавнее, а неограниченный список в
   * хранилище вкладки рос бы всю сессию.
   */
  it("ИНВАРИАНТ: длина следа ограничена, старое отбрасывается", () => {
    let stack: string[] = [];
    for (let i = 0; i < BACK_STACK_LIMIT + 5; i++) stack = recordVisit(stack, `/p${i}`);
    expect(stack).toHaveLength(BACK_STACK_LIMIT);
    expect(stack[stack.length - 1]).toBe(`/p${BACK_STACK_LIMIT + 4}`);
    expect(stack[0]).toBe("/p5");
  });

  it("исходный след не меняется на месте", () => {
    const stack = ["/connect"];
    recordVisit(stack, "/admin");
    expect(stack).toEqual(["/connect"]);
  });
});

describe("canStepBack и previousPath", () => {
  /**
   * ИНВАРИАНТ: с одним шагом возвращаться некуда. Это и есть случай «страницу
   * открыли по прямой ссылке первой в этой вкладке» — тогда кнопка ведёт в место
   * по умолчанию, как раньше.
   */
  it("ИНВАРИАНТ: один шаг — возвращаться некуда", () => {
    expect(canStepBack([])).toBe(false);
    expect(canStepBack(["/settings"])).toBe(false);
    expect(previousPath(["/settings"])).toBeNull();
  });

  it("два шага — возврат на предыдущий", () => {
    expect(canStepBack(["/admin", "/admin/vpn"])).toBe(true);
    expect(previousPath(["/admin", "/admin/vpn"])).toBe("/admin");
  });

  /**
   * ИНВАРИАНТ И ЕСТЬ САМ СМЫСЛ ПРАВКИ: возврат зависит от того, откуда пришли, а
   * не от страницы, на которой стоишь.
   */
  it("ИНВАРИАНТ: из одной страницы «назад» ведёт по-разному", () => {
    const fromAdmin = recordVisit(recordVisit([], "/admin"), "/settings/notifications");
    const fromConnect = recordVisit(recordVisit([], "/connect"), "/settings/notifications");
    expect(previousPath(fromAdmin)).toBe("/admin");
    expect(previousPath(fromConnect)).toBe("/connect");
  });
});

describe("parseStack", () => {
  it("читает сохранённый след", () => {
    expect(parseStack(JSON.stringify(["/connect", "/admin"]))).toEqual(["/connect", "/admin"]);
  });

  /**
   * ИНВАРИАНТ: мусор в хранилище не роняет страницу. Туда мог записать кто угодно
   * — расширение браузера, прежняя версия приложения, сам человек из консоли.
   */
  it("ИНВАРИАНТ: мусор даёт пустой след, а не исключение", () => {
    expect(parseStack(null)).toEqual([]);
    expect(parseStack("")).toEqual([]);
    expect(parseStack("{не json")).toEqual([]);
    expect(parseStack(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseStack(JSON.stringify([1, 2, 3]))).toEqual([]);
  });

  /**
   * ИНВАРИАНТ: в след принимаются только пути своего приложения. Иначе записью
   * «https://чужой-сайт» можно было бы превратить кнопку «назад» в переход наружу.
   */
  it("ИНВАРИАНТ: чужие адреса в след не попадают", () => {
    expect(parseStack(JSON.stringify(["/connect", "https://example.com", "//evil.tld", "/admin"]))).toEqual([
      "/connect",
      "/admin",
    ]);
  });

  it("ИНВАРИАНТ: обратные слэши и протокольные адреса тоже не проходят", () => {
    expect(isInAppPath("/connect")).toBe(true);
    expect(isInAppPath("//evil.tld")).toBe(false);
    expect(isInAppPath("/\\evil.tld")).toBe(false);
    expect(isInAppPath("https://example.com")).toBe(false);
    expect(isInAppPath("connect")).toBe(false);
    expect(isInAppPath(42)).toBe(false);
  });

  it("слишком длинный сохранённый след обрезается", () => {
    const long = Array.from({ length: BACK_STACK_LIMIT + 10 }, (_, i) => `/p${i}`);
    expect(parseStack(JSON.stringify(long))).toHaveLength(BACK_STACK_LIMIT);
  });
});

/**
 * ── Зацикливание ────────────────────────────────────────────────────────────
 *
 * Главное правило одно: шаг назад НИКОГДА не приводит на тот путь, с которого
 * его сделали. Пока это так, «назад» — лесенка, а не круг.
 */
describe("stepBack: шаг назад по следу", () => {
  it("обычный случай: возврат на предыдущий путь", () => {
    const { target, stack } = stepBack(["/connect", "/settings"], "/settings");
    expect(target).toBe("/connect");
    // Вершиной следа становится то, куда перешли, — иначе следующий шаг соврёт.
    expect(stack).toEqual(["/connect"]);
  });

  it("ИНВАРИАНТ: шаг никогда не ведёт на текущий путь", () => {
    /* Ровно этот случай и зацикливал кнопку: в следе сверху тот же путь, на
       котором мы стоим, — вернуться «назад» в самого себя невозможно. */
    const { target } = stepBack(["/connect", "/settings", "/settings"], "/settings");
    expect(target).toBe("/connect");
  });

  it("ФИКСАЦИЯ: несколько повторов подряд тоже не задерживают", () => {
    const stack = ["/connect", "/admin", "/settings", "/settings", "/settings"];
    expect(stepBack(stack, "/settings").target).toBe("/admin");
  });

  it("в следе только текущий путь — идти некуда, нужен запасной адрес", () => {
    expect(stepBack(["/settings"], "/settings").target).toBeNull();
    expect(stepBack([], "/settings").target).toBeNull();
  });

  it("след отстал и текущего пути в нём нет — возвращаемся на его вершину", () => {
    /* Страницу открыли по прямой ссылке: трекер ещё не записал её. Вершина
       следа — законное «откуда пришли». */
    expect(stepBack(["/connect", "/admin"], "/settings").target).toBe("/admin");
  });

  it("ИНВАРИАНТ: два шага подряд идут вглубь следа, а не топчутся", () => {
    /* Лесенка: /connect → /admin → /settings, и обратно теми же ступенями. */
    let stack = ["/connect", "/admin", "/settings"];
    const first = stepBack(stack, "/settings");
    expect(first.target).toBe("/admin");
    stack = first.stack;

    const second = stepBack(stack, "/admin");
    expect(second.target).toBe("/connect");
    expect(second.stack).toEqual(["/connect"]);

    // И на дне след кончается — дальше запасной адрес.
    expect(stepBack(second.stack, "/connect").target).toBeNull();
  });

  it("исходный след не меняется на месте", () => {
    const stack = ["/connect", "/settings"];
    stepBack(stack, "/settings");
    expect(stack).toEqual(["/connect", "/settings"]);
  });
});
