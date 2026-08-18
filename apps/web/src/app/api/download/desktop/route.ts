import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { extname } from "path";
import { Readable } from "stream";
import {
  listInstallerFiles,
  pickInstaller,
  readInstallerVersion,
  resolveInstallerPath,
  type DesktopOs,
} from "@/lib/desktopStore";

// ─────────────────────────────────────────────────────────────────────────────
// Desktop installer download endpoint — self-hosted.
//
// The desktop installers (Windows .exe, macOS .dmg, Linux .AppImage/.deb) are
// hosted *on this server*, in the same place electron-builder publishes to
// (`publish.url` / `nsisWeb.appPackageUrl` → https://trioz.ru/desktop/).
// There is deliberately **no dependency on GitHub**: this route reads the local
// download store and streams the matching installer straight to the browser,
// so clicking "Скачать" on /about starts the download immediately — no redirect
// to github.com, no "releases" detour.
//
// ANDROID-APK: тем же роутом раздаётся и Android-клиент — `?os=android`
// стримит `connect.apk` из того же хранилища (какое бы имя файл ни носил на
// диске, скачивается он всегда как connect.apk).
//
// The store is `apps/web/public/desktop` (in Docker a persistent volume). For
// resilience the installer is also discovered when dropped into a `public/`
// folder — see `@/lib/desktopStore` for the full search order.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
// Always resolve against the live filesystem so freshly published installers
// surface without a rebuild.
export const dynamic = "force-dynamic";

const CONTENT_TYPE: Record<string, string> = {
  ".exe": "application/vnd.microsoft.portable-executable",
  ".dmg": "application/x-apple-diskimage",
  ".zip": "application/zip",
  ".appimage": "application/octet-stream",
  ".deb": "application/vnd.debian.binary-package",
  ".apk": "application/vnd.android.package-archive",
};

// Resolve the target OS from an explicit `?os=` value, falling back to the
// User-Agent, and finally defaulting to Windows (the most common desktop).
// ANDROID-APK: android проверяется раньше linux — Android-браузеры содержат
// в User-Agent и "android", и "linux".
function detectOs(explicit: string | null, ua: string): DesktopOs {
  const v = (explicit || "").toLowerCase();
  if (v.startsWith("win")) return "windows";
  if (["mac", "macos", "darwin", "osx"].includes(v)) return "mac";
  if (v === "android") return "android";
  if (v === "linux") return "linux";

  const u = ua.toLowerCase();
  if (u.includes("android")) return "android";
  if (u.includes("windows")) return "windows";
  if (u.includes("mac") || u.includes("iphone") || u.includes("ipad")) return "mac";
  if (u.includes("linux")) return "linux";
  return "windows";
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(req: NextRequest) {
  const osParam = req.nextUrl.searchParams.get("os");
  const files = await listInstallerFiles();

  // Metadata mode (no `?os=`): tell the download UI what's available locally.
  if (!osParam) {
    const platforms = {
      windows: Boolean(pickInstaller(files, "windows")),
      mac: Boolean(pickInstaller(files, "mac")),
      linux: Boolean(pickInstaller(files, "linux")),
      android: Boolean(pickInstaller(files, "android")),
    };
    const available =
      platforms.windows || platforms.mac || platforms.linux || platforms.android;
    return NextResponse.json(
      {
        available,
        version: available ? await readInstallerVersion(files) : undefined,
        platforms,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Download mode: stream the matching installer straight to the browser.
  const os = detectOs(osParam, req.headers.get("user-agent") || "");
  const name = pickInstaller(files, os);
  if (!name) {
    return NextResponse.json(
      { error: "not_available", os },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const filePath = resolveInstallerPath(name);
  if (!filePath) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const info = await stat(filePath);
  const body = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;

  // ANDROID-APK: APK всегда скачивается под каноничным именем connect.apk,
  // как бы файл ни назывался в хранилище (app-release.apk и т.п.).
  const downloadName = os === "android" ? "connect.apk" : name;

  return new NextResponse(body, {
    headers: {
      "Content-Type": CONTENT_TYPE[extname(name).toLowerCase()] || "application/octet-stream",
      "Content-Length": String(info.size),
      "Content-Disposition": contentDisposition(downloadName),
      "Cache-Control": "no-store",
    },
  });
}
