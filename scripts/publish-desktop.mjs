#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Publish desktop installers to the web app's self-hosted download store.
//
// Copies electron-builder output (apps/desktop/release/*) into the download
// store, from where the web app serves them — the /about download button (via
// /api/download/desktop) and the Electron auto-updater (via /desktop/). Run it
// after `npm run desktop:dist`.
//
//   npm run desktop:dist            # build installers for the current OS
//   npm run desktop:publish         # copy them into the repo's download store
//   npm run desktop:publish:docker  # copy them into the desktop_data volume
//
// Both the source (electron-builder output) and the destination (download
// store) are overridable via env vars, so the *same* script can publish either
// into the repo checkout (local dev) or straight into the `desktop_data` Docker
// volume the running container serves from (the `desktop-publish` compose
// service sets these):
//
//   DESKTOP_RELEASE_DIR   source dir      (default: apps/desktop/release)
//   DESKTOP_DOWNLOAD_DIR  destination dir (default: apps/web/public/desktop)
//                         — the very same var the download route reads.
//   DESKTOP_PUBLISH_CLEAN "1" (or --clean) removes previously published
//                         installers first (see below).
//
// See apps/web/public/desktop/README.md for the full flow.
// ─────────────────────────────────────────────────────────────────────────────
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC =
  process.env.DESKTOP_RELEASE_DIR || join(ROOT, "apps", "desktop", "release");
const DEST =
  process.env.DESKTOP_DOWNLOAD_DIR || join(ROOT, "apps", "web", "public", "desktop");

// The download store is a persistent volume, so a version bump would otherwise
// leave the previous installers sitting next to the new ones (and the download
// route, which matches by extension, could then hand out a stale build). With
// --clean / DESKTOP_PUBLISH_CLEAN=1 we wipe the old artifacts first — but only
// the ones we manage; README.md and .gitkeep are left untouched.
const CLEAN =
  process.argv.includes("--clean") || process.env.DESKTOP_PUBLISH_CLEAN === "1";

// Installers + the electron-updater feed (latest*.yml), block maps and the
// nsis-web app package (*.7z). Everything else in release/ is build scaffolding.
const KEEP_EXT = new Set([
  ".exe",
  ".dmg",
  ".zip",
  ".appimage",
  ".deb",
  ".7z",
  ".blockmap",
]);

// Among YAML files only the electron-updater feeds are needed (latest.yml,
// latest-mac.yml, latest-linux.yml) — skip builder-debug.yml and friends.
const keep = (name) => {
  const ext = extname(name).toLowerCase();
  if (ext === ".yml" || ext === ".yaml") return /^latest/i.test(name);
  return KEEP_EXT.has(ext);
};

if (!existsSync(SRC)) {
  console.error(`No build output at ${SRC}\nRun "npm run desktop:dist" first.`);
  process.exit(1);
}

mkdirSync(DEST, { recursive: true });

if (CLEAN) {
  for (const name of readdirSync(DEST)) {
    const target = join(DEST, name);
    if (!statSync(target).isFile() || !keep(name)) continue;
    rmSync(target);
    console.log(`  - ${name}`);
  }
}

let copied = 0;
for (const name of readdirSync(SRC)) {
  const from = join(SRC, name);
  if (!statSync(from).isFile()) continue;
  if (!keep(name)) continue;
  cpSync(from, join(DEST, name));
  console.log(`  + ${name}`);
  copied += 1;
}

console.log(
  copied
    ? `\nPublished ${copied} file(s) to ${DEST}`
    : `\nNo installer artifacts found in ${SRC}`,
);
