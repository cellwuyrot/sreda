import { existsSync, readFileSync, statSync } from "fs";
import { readdir } from "fs/promises";
import { dirname, extname, join, resolve, sep } from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Desktop installer store — where the self-hosted installers live.
//
// The canonical location is the web app's `public/desktop` directory (in Docker
// that path is the `desktop_data` volume). Historically that was the *only*
// place the download route looked, so an installer dropped anywhere else — most
// commonly straight into a `public/` folder — was silently ignored and the
// /about button stayed hidden ("Скоро…").
//
// To make the common placements "just work", installers are now discovered from
// a small, prioritized list of directories. `public/desktop` still wins, but we
// also look in the app's `public/` root and — because production runs the app
// from the monorepo root (`pm2 start npm --name trioz -- start`, whose working
// directory is `apps/web`) — the monorepo root's `public/` (e.g.
// `/var/www/trioz/public`) and finally electron-builder's own output dir
// (`apps/desktop/release`), so a freshly built installer is served without a
// separate publish step. Set `DESKTOP_DOWNLOAD_DIR` to pin an exact folder.
//
// ANDROID-APK: тем же механизмом раздаётся и Android-клиент — файл
// `connect.apk` кладётся в то же хранилище (обычно `public/desktop`), после
// чего на /about появляется кнопка «Скачать для Android», а роут
// `/api/download/desktop?os=android` стримит APK напрямую.
//
// Only installer-related files (`.exe/.dmg/.zip/.AppImage/.deb/.apk`, the
// `latest*.yml` update feed, `.blockmap`, `.7z`) are ever listed or served, so
// unrelated public assets (icons, `robots.txt`, …) can never masquerade as a
// build.
// ─────────────────────────────────────────────────────────────────────────────

export type DesktopOs = "windows" | "mac" | "linux" | "android";

// Installer packages the /about button hands out.
const INSTALLER_EXT = new Set([".exe", ".dmg", ".zip", ".appimage", ".deb", ".apk"]);

// Everything the store legitimately serves: installers plus the
// electron-updater feed and its companions (block maps, the nsis-web *.7z
// package). Used to bound what `/desktop/<file>` will resolve.
const SERVE_EXT = new Set([...INSTALLER_EXT, ".7z", ".blockmap", ".yml", ".yaml"]);

// Walk up from the working directory to the monorepo root — the directory whose
// package.json declares npm workspaces. Returns null if not found.
function findMonorepoRoot(start: string): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    try {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg && pkg.workspaces) return dir;
      }
    } catch {
      /* unreadable/!json — keep climbing */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// The prioritized list of directories to search for installers. First match
// wins, so the canonical `public/desktop` always takes precedence over the
// fallbacks. Duplicates are removed while preserving order.
export function desktopStoreDirs(): string[] {
  const cwd = process.cwd();
  const dirs: string[] = [];
  const add = (d?: string | null) => {
    if (!d) return;
    const abs = resolve(d);
    if (!dirs.includes(abs)) dirs.push(abs);
  };

  add(process.env.DESKTOP_DOWNLOAD_DIR); // explicit override
  add(join(cwd, "public", "desktop")); // canonical store
  add(join(cwd, "public")); // app public root (common misplacement)

  const root = findMonorepoRoot(cwd);
  if (root && root !== cwd) {
    add(join(root, "public", "desktop"));
    add(join(root, "public")); // e.g. /var/www/trioz/public
    // electron-builder's own output dir. Serving straight from here means a
    // fresh `npm run desktop:dist:auto` is live for both the /about button and
    // the auto-update feed with no copy step. Lowest priority, so a populated
    // canonical `public/desktop` (via `desktop:publish`) always wins over it.
    add(join(root, "apps", "desktop", "release"));
    // ANDROID-APK: свежесобранный debug/release APK из Android Studio тоже
    // подхватывается без отдельного шага публикации (низший приоритет —
    // выложенный в `public/desktop` connect.apk всегда важнее).
    add(join(root, "apps", "android", "app", "build", "outputs", "apk", "release"));
    add(join(root, "apps", "android", "app", "build", "outputs", "apk", "debug"));
  }

  return dirs;
}

function isRelevant(name: string): boolean {
  const ext = extname(name).toLowerCase();
  if (INSTALLER_EXT.has(ext)) return true;
  return /^latest.*\.ya?ml$/i.test(name); // the electron-updater feed only
}

// Unique installer-related file names found across the store directories.
export async function listInstallerFiles(): Promise<string[]> {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const dir of desktopStoreDirs()) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // dir doesn't exist here — try the next candidate
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!isRelevant(entry.name)) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      names.push(entry.name);
    }
  }
  return names;
}

// Resolve an installer file name to an absolute path, searching the store
// directories in priority order. Guards against path traversal and only ever
// resolves installer-related files.
export function resolveInstallerPath(name: string): string | null {
  const ext = extname(name).toLowerCase();
  if (!SERVE_EXT.has(ext)) return null;
  for (const dir of desktopStoreDirs()) {
    const root = resolve(dir);
    const target = resolve(root, name);
    if (target !== root && !target.startsWith(root + sep)) continue; // traversal guard
    try {
      if (statSync(target).isFile()) return target;
    } catch {
      /* not in this dir — try the next candidate */
    }
  }
  return null;
}

// Choose the installer that matches an OS. electron-builder stamps the version
// into the file name, so we match on extension rather than a fixed name. For
// Windows we prefer the standalone (offline) NSIS installer over the smaller
// "web" stub, which needs a populated download host to finish installing.
// ANDROID-APK: для Android каноничное имя — `connect.apk`; если его нет,
// подойдёт любой .apk (например, app-release.apk прямо из сборки).
export function pickInstaller(names: string[], os: DesktopOs): string | undefined {
  const find = (pred: (name: string) => boolean) =>
    names.find((f) => pred(f.toLowerCase()));

  if (os === "windows") {
    return (
      find((n) => n.endsWith(".exe") && !n.includes("web")) ||
      find((n) => n.endsWith(".exe"))
    );
  }
  if (os === "mac") {
    return find((n) => n.endsWith(".dmg")) || find((n) => n.endsWith(".zip"));
  }
  if (os === "android") {
    return (
      find((n) => n === "connect.apk") ||
      find((n) => n.endsWith("-release.apk")) ||
      find((n) => n.endsWith(".apk"))
    );
  }
  return find((n) => n.endsWith(".appimage")) || find((n) => n.endsWith(".deb"));
}

// electron-builder drops `latest*.yml` update feeds next to the installers; the
// version lives there. Fall back to a semver found in any installer file name.
export async function readInstallerVersion(
  names: string[],
): Promise<string | undefined> {
  const yml = names.find((f) => /^latest.*\.yml$/i.test(f));
  if (yml) {
    const ymlPath = resolveInstallerPath(yml);
    if (ymlPath) {
      try {
        const text = readFileSync(ymlPath, "utf8");
        const m = text.match(/version:\s*([^\s]+)/i);
        if (m) return m[1];
      } catch {
        /* ignore and fall through */
      }
    }
  }
  for (const f of names) {
    // Strip the installer extension first so ".exe" isn't mistaken for a
    // build-metadata suffix (e.g. "…0.1.0.exe" → "0.1.0", not "0.1.0.exe").
    const base = f.slice(0, f.length - extname(f).length);
    const m = base.match(/\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)?/);
    if (m) return m[0];
  }
  return undefined;
}
