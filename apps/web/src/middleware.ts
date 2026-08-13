import { NextRequest, NextResponse } from "next/server";

/**
 * FIX-CSP: правила содержимого с одноразовым nonce.
 *
 * Раньше CSP задавалась статически в next.config.mjs и содержала
 * `script-src 'unsafe-inline'`. С таким разрешением браузер не может отличить
 * наш скрипт от врезанного через XSS — то есть самая важная часть CSP не
 * работала вовсе. Nonce меняется на каждый ответ, и врезка его угадать
 * не может. Next.js сам подставляет nonce в свои скрипты, если видит его в
 * заголовке ЗАПРОСА — поэтому заголовок выставляется в двух местах.
 *
 * Остальные заголовки безопасности по-прежнему живут в next.config.mjs: они
 * действительно статичны.
 */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  /* 'wasm-unsafe-eval' нужен шумоподавлению (RNNoise — WebAssembly в AudioWorklet).
     'unsafe-eval' — только в разработке: без него не работает горячая замена
     модулей. В сборке его нет. */
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    "blob:",
    process.env.NODE_ENV === "development" ? "'unsafe-eval'" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    `script-src ${scriptSrc}`,
    "worker-src 'self' blob:",
    "object-src 'self' blob:",
    "frame-src 'self' blob:",
    // Стили остаются с 'unsafe-inline': так работают style-атрибуты React и
    // переменные темы. Стиль не исполняет код — риск несравним с скриптом.
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https: tzmedia:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' ws: wss: https://api.openai.com https://api.anthropic.com",
    "media-src 'self' blob:",
    "form-action 'self'",
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  /* Статика, картинки, вложения и сокет — мимо: там нет разметки, а лишний
     проход middleware на каждый файл только замедляет выдачу. */
  matcher: ["/((?!_next/static|_next/image|api/socketio|favicon.ico|uploads/).*)"],
};
