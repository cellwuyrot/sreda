/**
 * FIX-SEC: настоящий адрес клиента.
 *
 * Раньше и лимиты, и блокировки брали ПЕРВОЕ значение из `X-Forwarded-For`. Этот
 * заголовок присылает сам клиент, поэтому одна строка в запросе обнуляла и
 * лимит попыток входа, и блокировку устройства: каждый запрос выглядел приходом
 * с нового адреса.
 *
 * Доверять можно только тому, что дописал НАШ прокси, а он дописывает адрес
 * справа. Поэтому:
 *  - сначала `X-Real-IP` — nginx выставляет его из `$remote_addr`, подделать
 *    его снаружи невозможно (см. nginx.conf, proxy_set_header);
 *  - иначе берём hop справа: `TRUSTED_PROXY_HOPS` — сколько наших прокси стоит
 *    перед приложением (по умолчанию один: nginx).
 *
 * Если приложение вдруг окажется открытым в интернет напрямую, худшее, что
 * получится, — все запросы попадут в одну корзину лимита, а не в разные.
 */

const TRUSTED_HOPS = (() => {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
})();

/** Универсальный вариант: NextAuth отдаёт заголовки простым объектом. */
export function clientIpFromHeaders(get: (name: string) => string | null | undefined): string | null {
  const real = (get("x-real-ip") || "").trim();
  if (real) return real;

  const fwd = (get("x-forwarded-for") || "").trim();
  if (!fwd) return null;

  const hops = fwd.split(",").map((h) => h.trim()).filter(Boolean);
  if (hops.length === 0) return null;

  const index = Math.max(0, hops.length - TRUSTED_HOPS);
  return hops[index] ?? null;
}

export function clientIpOf(req: { headers: { get(name: string): string | null } }): string | null {
  return clientIpFromHeaders((name) => req.headers.get(name));
}
