#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Build the desktop installers for the current OS with an auto-derived version.
//
// Thin wrapper around `electron-builder` that (1) stamps the version resolved by
// scripts/desktop-version.mjs and (2) wipes the previous `release/` output first.
//
// Why clean release/? electron-builder does not purge old outputs, and the
// download store matches installers by *extension* — so a leftover
// `…Setup 0.1.1.exe` sitting next to a fresh `…Setup 0.1.115.exe` could be the
// one that gets served. Emptying release/ guarantees it only ever holds the
// build we just made, keeping the installer and the `latest.yml` feed in sync.
//
// Run it through the npm scripts, which compile the TypeScript first:
//   npm run desktop:dist:auto     # build only
//   npm run desktop:release       # build + publish into the download store
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDesktopVersion } from "./desktop-version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = join(ROOT, "apps", "desktop");
const RELEASE = join(DESKTOP, "release");

const version = resolveDesktopVersion();
console.log(`[desktop] building installers for version ${version}`);

// Empty the previous output so only the current build survives (see header).
if (existsSync(RELEASE)) {
  for (const name of readdirSync(RELEASE)) {
    rmSync(join(RELEASE, name), { recursive: true, force: true });
  }
}

// Pass any extra CLI args straight through (e.g. `--linux --win`). `-c` overrides
// package.json's version for this build only — nothing needs to be committed.
const passthrough = process.argv.slice(2);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(
  npx,
  ["electron-builder", ...passthrough, `-c.extraMetadata.version=${version}`],
  { cwd: DESKTOP, stdio: "inherit" },
);
