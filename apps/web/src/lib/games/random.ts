/**
 * Случайность для игрового исхода.
 *
 * FIX-RNG: раньше исход бросков, выпадений и ходов бота считался через
 * Math.random(). Его поток предсказуем: наблюдая достаточно выдач, можно
 * восстановить состояние и знать будущие — а здесь от исхода зависит игровой
 * результат и награды. crypto.getRandomValues даёт то же удобство без этого
 * свойства и есть и в браузере, и в Node.
 */

/** Дробное в [0, 1) — замена Math.random() один в один. */
export function secureRandom(): number {
  const buf = new Uint32Array(2);
  globalThis.crypto.getRandomValues(buf);
  // 53 бита — вся точность double, без перекоса к краям.
  return ((buf[0] >>> 5) * 2 ** 26 + (buf[1] >>> 6)) / 2 ** 53;
}

/** Целое в [0, maxExclusive) без перекоса остатка от деления. */
export function secureInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("secureInt: ожидается положительное целое");
  }
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  let value = 0;
  do {
    globalThis.crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % maxExclusive;
}
