#!/usr/bin/env node
/**
 * TRUSTTUNNEL-WIN: put the official TrustTunnel Windows client into
 * resources/trusttunnel/win32 (electron-builder → resourcesPath/trusttunnel).
 *
 * Source: the pinned upstream release (Apache-2.0), verified by SHA-256 of the
 * zip AND of every extracted file (same hashes are re-checked by the elevated
 * installer script on the user's machine, see src/shared/trustTunnelWin.ts).
 *
 *   npm run vendor:trusttunnel                    # downloads from GitHub
 *   TRIOZ_TT_ZIP=C:\path\tt.zip npm run vendor:trusttunnel   # offline zip
 *   TRIOZ_TT_ALLOW_MISSING=1 ...                  # dev only: continue without it
 *
 * Pure Node (zlib), no unzip/tar needed. Skips on non-Windows hosts unless
 * --force is given, because only the Windows installer bundles it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "resources", "trusttunnel", "win32");
const URL_ = "https://github.com/TrustTunnel/TrustTunnelClient/releases/download/v1.1.12/trusttunnel_client-v1.1.12-windows-x86_64.zip";
const ZIP_SHA256 = "56fb620f4cd30abbc1b4586c6645b56d90c8c0e977ba53d95fb0f542acb7cb1f";
const FILES = {
  "trusttunnel_client.exe": "5cf4c9c5c19bc5fce03f4b37b97c23c3b819f6a08de778a1df71180358226765",
  "wintun.dll": "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce",
  "LICENSE.txt": null,
  "WINTUN_LICENSE.txt": null,
};
const sha = (b) => createHash("sha256").update(b).digest("hex");
const allowMissing = process.env.TRIOZ_TT_ALLOW_MISSING === "1" || process.argv.includes("--allow-missing");

function done(msg, ok) {
  if (ok) { console.log(`[trusttunnel] ${msg}`); process.exit(0); }
  console.error(`[trusttunnel] ОШИБКА: ${msg}`);
  if (allowMissing) { console.error("[trusttunnel] TRIOZ_TT_ALLOW_MISSING=1 — сборка продолжится БЕЗ TrustTunnel"); process.exit(0); }
  console.error("[trusttunnel] Скачайте zip вручную и задайте TRIOZ_TT_ZIP=<путь>, URL: " + URL_);
  process.exit(1);
}

/** Minimal ZIP reader: central directory → local header → stored/deflate. */
export function extractZip(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("zip: no central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip: bad central entry");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen).split("/").pop();
    p += 46 + nlen + xlen + clen;
    if (!wanted.includes(name)) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("zip: bad local header");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!data || data.length !== usize) throw new Error("zip: unsupported entry " + name);
    out[name] = data;
  }
  return out;
}

async function main() {
  if (process.platform !== "win32" && !process.argv.includes("--force")) done("не Windows — пропуск (используйте --force)", true);
  if (Object.entries(FILES).every(([f, h]) => existsSync(join(outDir, f)) && (!h || sha(readFileSync(join(outDir, f))) === h)))
    done("уже на месте, хеши совпадают", true);
  let zip;
  try {
    if (process.env.TRIOZ_TT_ZIP) zip = readFileSync(process.env.TRIOZ_TT_ZIP);
    else {
      const res = await fetch(URL_, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      zip = Buffer.from(await res.arrayBuffer());
    }
  } catch (e) { done(`не удалось получить архив: ${e.message}`, false); }
  if (sha(zip) !== ZIP_SHA256) done("SHA-256 архива не совпадает с закреплённым — архив отклонён", false);
  const files = extractZip(zip, Object.keys(FILES));
  mkdirSync(outDir, { recursive: true });
  for (const [name, hash] of Object.entries(FILES)) {
    if (!files[name]) done(`в архиве нет ${name}`, false);
    if (hash && sha(files[name]) !== hash) done(`SHA-256 ${name} не совпадает`, false);
    writeFileSync(join(outDir, name), files[name]);
  }
  done(`клиент v1.1.12 разложен в ${outDir}`, true);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
