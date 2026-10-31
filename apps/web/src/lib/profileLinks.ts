/** Public profile links: allow only explicit HTTP(S), without embedded credentials. */
export function profileLinks(raw: unknown): { label: string; href: string; domain: string }[] {
  let links: Record<string, unknown>;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    links = parsed;
  } catch { return []; }
  return Object.entries({ website: "Мой сайт", github: "GitHub", telegram: "Telegram", vk: "VK" }).flatMap(([key, label]) => {
    const value = links[key];
    if (typeof value !== "string") return [];
    try {
      const url = new URL(value.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return [];
      return [{ label, href: url.href, domain: url.hostname }];
    } catch { return []; }
  });
}
