#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Resolve the version to stamp into a desktop build.
//
// electron-updater only offers an update when the feed's version is *strictly
// greater* than the installed one. If every rebuild keeps the committed
// `apps/desktop/package.json` version (historically frozen at 0.1.x), the feed
// never advances and installed clients stay put — no matter how many times you
// rebuild and publish. This resolver makes the version move on its own so that
// "every project update" produces a strictly-newer build.
//
// Resolution order (first match wins):
//   1. $DESKTOP_VERSION            — explicit override (leading "v" stripped)
//   2. a `v*` git tag on HEAD      — keeps existing tag-driven releases intact
//   3. <major>.<minor>.<commits>   — patch = `git rev-list --count HEAD`, which
//                                     strictly increases with every new commit
//   4. package.json version        — fallback when git history is unavailable
//
// The <major>.<minor> base comes from apps/desktop/package.json, so bumping the
// minor there (e.g. 0.1 → 0.2) lets you jump the version forward; the patch is
// always derived from the commit count and needs no manual maintenance.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return ""; // not a git checkout / git missing — callers fall through
  }
}

export function resolveDesktopVersion() {
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "apps", "desktop", "package.json"), "utf8"),
  );

  // 1. Explicit override.
  const override = process.env.DESKTOP_VERSION;
  if (override) return override.replace(/^v/, "");

  // 2. A version tag on HEAD wins, so a deliberate `git tag v1.2.3` release
  //    behaves exactly as before.
  const tag = git(["tag", "--points-at", "HEAD"])
    .split("\n")
    .map((t) => t.trim())
    .find((t) => /^v\d+\.\d+\.\d+/.test(t));
  if (tag) return tag.replace(/^v/, "");

  // 3. Derive the patch from the commit count. Each new commit → a strictly
  //    greater version, which is the one thing electron-updater checks.
  const [major = "0", minor = "0"] = String(pkg.version || "0.0.0").split(".");
  const count = git(["rev-list", "--count", "HEAD"]);
  if (/^\d+$/.test(count)) return `${major}.${minor}.${count}`;

  // 4. No git history (shallow/empty checkout) — fall back to the committed
  //    version so a build never fails outright.
  return pkg.version || "0.0.0";
}

// When run directly (`node scripts/desktop-version.mjs`) print the version so it
// can be captured in a shell (`VERSION="$(node scripts/desktop-version.mjs)"`).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(resolveDesktopVersion() + "\n");
}
