/**
 * FIX-AWG: параметры маскировки AmneziaWG — проверка, генерация, ротация.
 *
 * Зачем отдельный файл. AmneziaWG — это обычный WireGuard с одним добавлением:
 * перед настоящим рукопожатием он отправляет мусорные пакеты и меняет размеры и
 * типы служебных пакетов. Криптография не трогается вообще — меняется только то,
 * как трафик выглядит со стороны. Поэтому здесь нет и не должно быть никакой
 * своей криптографии: только числа и проверка их допустимости.
 *
 * И ровно поэтому числа нельзя брать «какие-нибудь». Неверный набор не даёт
 * понятной ошибки: туннель либо никогда не встаёт, либо встаёт и молча теряет
 * пакеты. Разбираться в этом со стороны клиента практически невозможно — в
 * журнале WireGuard видно лишь то, что рукопожатие не сошлось.
 *
 * Три ловушки, которые проверяются здесь и которых не было в прежней проверке
 * диапазонов в `vpn.ts`:
 *
 * 1. `S1 + 56 === S2`. Пакет инициации длиннее пакета ответа ровно на 56 байт.
 *    Если добавки выбраны так, что размеры сравнялись, реализации awg перестают
 *    различать два типа пакетов — соединение не устанавливается.
 * 2. Одинаковые `H1..H4`. Это подмена типов четырёх служебных пакетов. Если
 *    хотя бы два значения совпали, два разных типа стали одним.
 * 3. `Jmin >= Jmax`. Границы размера мусорного пакета. При перевёрнутых
 *    границах awg либо не запускается, либо шлёт пакеты нулевой длины.
 *
 * Отдельно про полноту набора: половина параметров хуже, чем ни одного. Пустой
 * набор — это законный обычный WireGuard, который откроется любым клиентом,
 * включая мобильный. А набор из четырёх полей вместо одиннадцати означает, что
 * клиент и узел посчитают размеры по-разному, и рукопожатие не сойдётся никогда.
 */

/** Порядок полей в профиле. awg требует их до `PrivateKey` в секции `[Interface]`. */
export const AWG_KEYS = ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4"] as const;

export type AwgKey = (typeof AWG_KEYS)[number];
export type AwgParams = Partial<Record<AwgKey, number>>;

/**
 * Границы значений.
 *
 * `Jc` — сколько мусорных пакетов отправить перед рукопожатием. Больше четырёх
 * практического смысла не добавляют, зато заметно замедляют подключение: каждый
 * пакет — это задержка на старте, которую пользователь видит как «долго
 * включается». `Jmin`/`Jmax` — размер этого мусора; слишком крупный мусор сам
 * становится приметой. `S1..S4` — добавка к служебным пакетам, `H1..H4` — подмена
 * их типов.
 */
export const AWG_LIMITS: Record<AwgKey, { min: number; max: number }> = {
  Jc: { min: 1, max: 8 },
  Jmin: { min: 8, max: 1_000 },
  Jmax: { min: 16, max: 1_280 },
  S1: { min: 15, max: 150 },
  S2: { min: 15, max: 150 },
  S3: { min: 0, max: 150 },
  S4: { min: 0, max: 150 },
  H1: { min: 5, max: 2_147_483_647 },
  H2: { min: 5, max: 2_147_483_647 },
  H3: { min: 5, max: 2_147_483_647 },
  H4: { min: 5, max: 2_147_483_647 },
};

/**
 * Почему набор нельзя отдавать клиенту. Пустая строка — всё в порядке.
 *
 * Возвращается именно текст причины, а не `false`: этот текст показывается
 * администратору в панели. «Параметры неверны» без указания поля означало бы
 * перебор одиннадцати значений вручную.
 */
export function awgProblem(params: unknown): string {
  if (!params || typeof params !== "object") return "Параметры маскировки пришли не объектом";
  const value = params as Record<string, unknown>;

  const present = AWG_KEYS.filter((key) => value[key] !== undefined && value[key] !== "" && value[key] !== null);
  /* Ни одного поля — это обычный WireGuard, а не ошибка. */
  if (present.length === 0) return "";

  if (present.length !== AWG_KEYS.length) {
    const missing = AWG_KEYS.filter((key) => !present.includes(key));
    return `Набор параметров неполный, не хватает: ${missing.join(", ")}`;
  }

  const num: Record<string, number> = {};
  for (const key of AWG_KEYS) {
    const raw = value[key];
    const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isInteger(parsed)) return `Параметр ${key} должен быть целым числом`;
    const limit = AWG_LIMITS[key];
    if (parsed < limit.min || parsed > limit.max) {
      return `Параметр ${key} вне допустимых границ (${limit.min}–${limit.max})`;
    }
    num[key] = parsed;
  }

  if (num.Jmin >= num.Jmax) return "Jmin должен быть меньше Jmax";
  if (num.S1 + 56 === num.S2) return "S1 + 56 не должно равняться S2";
  if (new Set([num.H1, num.H2, num.H3, num.H4]).size !== 4) return "Значения H1–H4 должны быть разными";

  return "";
}

/** Короткая проверка без текста причины. */
export function isValidAwgParams(params: unknown): boolean {
  return awgProblem(params) === "";
}

/**
 * Случайный допустимый набор для ОДНОГО узла.
 *
 * Одинаковые числа на всех узлах сводят всю затею к нулю: набор становится
 * подписью сервиса, которую достаточно увидеть один раз, чтобы затем узнавать
 * его на любом адресе. Поэтому у каждого узла свои значения.
 *
 * Генератор передаётся параметром только ради предсказуемости в тестах. Он не
 * криптографический и не должен быть: эти числа ничего не шифруют и не являются
 * секретом — клиент получает их в открытом виде в своём профиле.
 */
export function generateAwgParams(random: () => number = Math.random): Required<AwgParams> {
  const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

  const jmin = pick(24, 96);
  const jmax = pick(jmin + 32, jmin + 400);

  const s1 = pick(20, 80);
  let s2 = pick(20, 80);
  /* Сдвигаем, а не перегенерируем: цикл со случайностью может не завершиться. */
  if (s1 + 56 === s2) s2 += 1;

  const headers = new Set<number>();
  while (headers.size < 4) headers.add(pick(10, 2_000_000_000));
  const [h1, h2, h3, h4] = [...headers];

  return {
    Jc: pick(3, 6),
    Jmin: jmin,
    Jmax: jmax,
    S1: s1,
    S2: s2,
    S3: pick(20, 80),
    S4: pick(20, 80),
    H1: h1 as number,
    H2: h2 as number,
    H3: h3 as number,
    H4: h4 as number,
  };
}

/**
 * Допустимые порты точки подключения.
 *
 * Один 51820 на все узлы — самый простой способ быть заблокированным одной
 * строчкой фильтра. Порт меняется БЕЗ перевыпуска ключей: приватный ключ
 * остаётся на устройстве, меняется только строка `Endpoint` в профиле. Это
 * важное свойство — перевыпуск ключей означал бы, что при каждой блокировке все
 * клиенты разом теряют доступ и должны заново получить профиль.
 *
 * 443 и 8443 выбраны потому, что это порты, которые почти нигде не закрывают;
 * 2408 — общеизвестный порт UDP-туннелей. Никакой маскировки под чужой протокол
 * здесь нет: по этим портам идёт обычный WireGuard/AmneziaWG.
 */
export const ALLOWED_ENDPOINT_PORTS = [51820, 443, 8443, 2408, 51821, 51822] as const;

export function isAllowedEndpointPort(port: unknown): boolean {
  return ALLOWED_ENDPOINT_PORTS.includes(Number(port) as (typeof ALLOWED_ENDPOINT_PORTS)[number]);
}

/**
 * Следующий порт для перебора, если текущий не работает.
 *
 * Перебор кольцевой и без случайности: клиент должен обойти все варианты ровно
 * по одному разу, а не топтаться на двух случайных, пока пользователь смотрит
 * на «подключение…».
 */
export function nextEndpointPort(current: unknown): number {
  const index = ALLOWED_ENDPOINT_PORTS.indexOf(Number(current) as (typeof ALLOWED_ENDPOINT_PORTS)[number]);
  if (index < 0) return ALLOWED_ENDPOINT_PORTS[0];
  return ALLOWED_ENDPOINT_PORTS[(index + 1) % ALLOWED_ENDPOINT_PORTS.length];
}
