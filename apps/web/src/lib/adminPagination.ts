/** Strict, bounded pagination shared by administrative lists. */
export const ADMIN_PAGE_SIZE = 15;
export function positiveInteger(value: string | null, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, maximum) : fallback;
}
