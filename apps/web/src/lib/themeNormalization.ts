/** Convert old stored light variants to their dark equivalents. */
export function normalizeTheme(value: string | null): "dark" | "mono" {
  return value === "mono" || value === "mono-lite" ? "mono" : "dark";
}
