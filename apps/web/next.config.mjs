/** @type {import('next').NextConfig} */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

// In the monorepo, npm workspaces hoist dependencies to the *root*
// node_modules, so the old `path.resolve("node_modules/…")` (relative to the
// app's own directory) no longer finds them. `require.resolve` locates each
// package by walking up the module tree, which works whether the dependency is
// hoisted to the root or nested under apps/web.
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pub = (...p) => path.join(__dirname, "public", ...p);

// Resolve a file inside an installed package (e.g. "pdfjs-dist/build/…") to an
// absolute path, regardless of where the package was hoisted. Returns null if
// the package cannot be found.
const resolvePkgFile = (spec) => {
  try {
    return require.resolve(spec);
  } catch {
    return null;
  }
};

// Resolve the on-disk root of an installed package by its package.json.
const resolvePkgDir = (pkg) => {
  const manifest = resolvePkgFile(`${pkg}/package.json`);
  return manifest ? path.dirname(manifest) : null;
};

// Copy the @jitsi/rnnoise-wasm binary to public/ at build time. The RNNoise
// AudioWorklet instantiates this WASM directly (see
// public/worklets/rnnoise-processor.js), so the Emscripten "sync" glue is not
// needed and is intentionally not copied.
try {
  const rnnoiseWasm = resolvePkgFile("@jitsi/rnnoise-wasm/dist/rnnoise.wasm");
  if (rnnoiseWasm && fs.existsSync(rnnoiseWasm))
    fs.copyFileSync(rnnoiseWasm, pub("rnnoise.wasm"));
} catch (err) {
  console.warn("[next.config] rnnoise copy skipped:", err.message);
}

// Copy the pdf.js worker to public/ so the Workspace PDF editor can load it
// from a same-origin URL (satisfies our `worker-src 'self'` CSP).
try {
  const pdfWorker = resolvePkgFile("pdfjs-dist/build/pdf.worker.min.js");
  if (pdfWorker && fs.existsSync(pdfWorker))
    fs.copyFileSync(pdfWorker, pub("pdf.worker.min.js"));

  // Also copy the standard-font and CMap data. pdf.js needs these to render
  // PDFs that rely on the base-14 fonts (Helvetica, Times, …) or non-Latin
  // (e.g. CJK) encodings; without them such pages render blank. Serving them
  // same-origin keeps them within our `connect-src 'self'` CSP.
  const pdfjsDir = resolvePkgDir("pdfjs-dist");
  const copyDir = (from, to) => {
    if (from && fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
  };
  if (pdfjsDir) {
    copyDir(path.join(pdfjsDir, "standard_fonts"), pub("pdfjs", "standard_fonts"));
    copyDir(path.join(pdfjsDir, "cmaps"), pub("pdfjs", "cmaps"));
  }
} catch (err) {
  console.warn("[next.config] pdf asset copy skipped:", err.message);
}

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=()",
  },
  /* FIX-CSP: правила CSP переехали в src/middleware.ts.

     Здесь заголовок статичен, а значит единственным способом разрешить
     собственные встроенные скрипты было 'unsafe-inline' — а он сводит защиту
     от XSS к нулю: ровно таким скриптом и выглядит встроенная в страницу
     чужая врезка. Middleware выдаёт на каждый ответ свой nonce. */
];

const nextConfig = {
  output: "standalone",
  // FIX-CLIENTMEDIA: изображения пользователей (аватары, иконки сообществ,
  // баннеры) больше НЕ проходят через серверный оптимизатор Next.js.
  //
  // По умолчанию каждый <Image> запрашивает /_next/image?url=…&w=…&q=…, и
  // сервер на лету декодирует и пережимает картинку через sharp, складывая
  // результат в свой кеш. Для пользовательского контента это чистые накладные
  // расходы: файлы и так небольшие, зато нагрузка на CPU и задержка первого
  // показа — на сервере. Теперь браузер получает исходный файл по прямой
  // ссылке /uploads/… и масштабирует его сам, а десктоп-клиент вдобавок держит
  // копию на диске (apps/desktop/src/main/mediaCache.ts).
  images: { unoptimized: true },
  // We live in a monorepo (apps/web). Point Next's dependency tracing at the
  // repository root so `output: "standalone"` traces hoisted, root-level
  // node_modules correctly and stops warning about multiple lockfiles.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      // FIX-BLANK: HTML страниц мессенджера НИКОГДА не кешируется на клиенте.
      //
      // Каждая сборка Next.js выпускает новые имена чанков
      // (/_next/static/chunks/<hash>.js) и удаляет прежние, а nginx отдаёт
      // статику с `immutable, max-age=1y`. Если у клиента в кеше осел HTML
      // прошлой сборки, после деплоя он запрашивает уже удалённые чанки: HTML
      // приходит из кеша (200), весь JS — 404, React не монтируется и
      // пользователь видит пустой тёмный экран. В десктоп-оболочке это
      // «лечилось» только переустановкой (она удаляла кеш вместе с userData).
      //
      // Сами чанки по-прежнему кешируются на год — их имена содержат хеш,
      // поэтому свежий HTML всегда попадает на актуальные файлы.
      {
        source: "/connect",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source: "/connect/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
