import { describe, expect, it } from "vitest";

import {
  ALLOWED_ENDPOINT_PORTS,
  AWG_KEYS,
  awgProblem,
  generateAwgParams,
  isAllowedEndpointPort,
  isValidAwgParams,
  nextEndpointPort,
} from "./awgParams";

/** Заведомо допустимый набор — от него отталкиваются отрицательные случаи. */
const GOOD = {
  Jc: 4,
  Jmin: 40,
  Jmax: 200,
  S1: 30,
  S2: 40,
  S3: 50,
  S4: 60,
  H1: 1_234_567,
  H2: 2_345_678,
  H3: 3_456_789,
  H4: 4_567_890,
};

describe("awgProblem", () => {
  it("допустимый набор проходит", () => {
    expect(awgProblem(GOOD)).toBe("");
    expect(isValidAwgParams(GOOD)).toBe(true);
  });

  it("пустой набор — это обычный WireGuard, а не ошибка", () => {
    expect(awgProblem({})).toBe("");
  });

  it("неполный набор отклоняется с перечнем недостающих полей", () => {
    const problem = awgProblem({ Jc: 4, Jmin: 40, Jmax: 200 });
    expect(problem).toContain("не хватает");
    expect(problem).toContain("S1");
    expect(problem).toContain("H4");
  });

  it("FIX-AWG: S1 + 56 не может равняться S2", () => {
    /* Ровно такое совпадение делает два типа служебных пакетов неразличимыми,
       и туннель не встаёт вообще — без внятной ошибки в журнале. */
    expect(awgProblem({ ...GOOD, S1: 30, S2: 86 })).toBe("S1 + 56 не должно равняться S2");
  });

  it("заголовки H1–H4 должны быть разными", () => {
    expect(awgProblem({ ...GOOD, H3: GOOD.H1 })).toContain("разными");
  });

  it("Jmin не может быть больше или равен Jmax", () => {
    expect(awgProblem({ ...GOOD, Jmin: 200, Jmax: 200 })).toContain("Jmin");
    expect(awgProblem({ ...GOOD, Jmin: 300, Jmax: 200 })).toContain("Jmin");
  });

  it("значения вне границ отклоняются с указанием поля", () => {
    expect(awgProblem({ ...GOOD, Jc: 0 })).toContain("Jc");
    expect(awgProblem({ ...GOOD, Jc: 99 })).toContain("Jc");
    expect(awgProblem({ ...GOOD, Jmax: 5_000 })).toContain("Jmax");
    expect(awgProblem({ ...GOOD, H1: 2 })).toContain("H1");
  });

  it("дробные и нечисловые значения отклоняются", () => {
    expect(awgProblem({ ...GOOD, S3: 30.5 })).toContain("целым");
    expect(awgProblem({ ...GOOD, S3: "мусор" })).toContain("целым");
    expect(awgProblem(null)).not.toBe("");
    expect(awgProblem("[]")).not.toBe("");
  });

  it("число строкой принимается: из отчёта узла они приходят текстом", () => {
    const asText = Object.fromEntries(AWG_KEYS.map((key) => [key, String(GOOD[key])]));
    expect(awgProblem(asText)).toBe("");
  });
});

describe("generateAwgParams", () => {
  it("любой сгенерированный набор проходит свою же проверку", () => {
    /* Гоняем много раз: ошибка в генераторе проявляется редким сочетанием,
       а не на первом же вызове — именно такие баги уезжают в продакшн. */
    for (let i = 0; i < 500; i += 1) {
      const params = generateAwgParams();
      expect(awgProblem(params)).toBe("");
    }
  });

  it("у разных узлов параметры разные", () => {
    /* Одинаковые числа на всех узлах сами стали бы подписью сервиса. */
    const first = JSON.stringify(generateAwgParams());
    const others = new Set([...Array(20)].map(() => JSON.stringify(generateAwgParams())));
    others.delete(first);
    expect(others.size).toBeGreaterThan(10);
  });

  it("с предсказуемым генератором границы соблюдены", () => {
    /* Крайние значения генератора: постоянные 0 и постоянные почти-1. */
    expect(awgProblem(generateAwgParams(() => 0))).toBe("");
    expect(awgProblem(generateAwgParams(() => 0.999999))).toBe("");
  });
});

describe("порты точки подключения", () => {
  it("разрешённые порты узнаются, посторонние — нет", () => {
    expect(isAllowedEndpointPort(51820)).toBe(true);
    expect(isAllowedEndpointPort("443")).toBe(true);
    expect(isAllowedEndpointPort(22)).toBe(false);
    expect(isAllowedEndpointPort(0)).toBe(false);
    expect(isAllowedEndpointPort("мусор")).toBe(false);
  });

  it("перебор кольцевой и обходит все варианты ровно по одному разу", () => {
    const seen: number[] = [];
    let port: number = ALLOWED_ENDPOINT_PORTS[0];
    for (let i = 0; i < ALLOWED_ENDPOINT_PORTS.length; i += 1) {
      seen.push(port);
      port = nextEndpointPort(port);
    }
    expect(new Set(seen).size).toBe(ALLOWED_ENDPOINT_PORTS.length);
    /* И возвращается к началу, а не упирается в конец списка. */
    expect(port).toBe(ALLOWED_ENDPOINT_PORTS[0]);
  });

  it("неизвестный порт переводит к первому разрешённому", () => {
    expect(nextEndpointPort(12_345)).toBe(ALLOWED_ENDPOINT_PORTS[0]);
    expect(nextEndpointPort(undefined)).toBe(ALLOWED_ENDPOINT_PORTS[0]);
  });
});
