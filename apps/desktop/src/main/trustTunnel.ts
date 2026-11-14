/**
 * TRUSTTUNNEL-WIN: «Надёжное соединение» (TrustTunnel) on Windows.
 * See shared/trustTunnelWin.ts for the security model. Separate from the
 * AmneziaWG tunnel; the two are mutually exclusive.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

import { IPC } from "../shared/constants";
import { isValidTrustTunnelProfile } from "../shared/trustTunnelPilotProfile";
import { buildDownScript, buildUpScript, TT_EXIT, TT_FILES } from "../shared/trustTunnelWin";
import { trustTunnelServiceState } from "./trustTunnelService";
import { getMainWindow } from "./mainWindow";
import { elevatedScript } from "./winTunnel";
import { isVpnActive } from "./vpn";
import { acquireVpnStart } from "./vpnStartLock";

export type TrustTunnelState = "off" | "connecting" | "on" | "disconnecting" | "error";
export interface TrustTunnelStatus { state: TrustTunnelState; error: string | null; supported: boolean }

let current: TrustTunnelStatus = { state: "off", error: null, supported: process.platform === "win32" };
let busy = false;

function emit(next: Partial<TrustTunnelStatus>): TrustTunnelStatus {
  current = { ...current, ...next, supported: process.platform === "win32" };
  getMainWindow()?.webContents.send(IPC.TT_STATE, current);
  return current;
}

/** Packaged: <resources>\trusttunnel. Dev: apps/desktop/resources/trusttunnel/win32. */
export function trustTunnelClientDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "trusttunnel")
    : join(app.getAppPath(), "resources", "trusttunnel", "win32");
}

function clientFilesOk(dir: string): boolean {
  try {
    return TT_FILES.every((f) => createHash("sha256").update(readFileSync(join(dir, f.name))).digest("hex") === f.sha256);
  } catch { return false; }
}

function pendingPath(): string {
  return join(app.getPath("userData"), "trusttunnel", "pending.toml");
}
function removePending(): void {
  try { rmSync(pendingPath(), { force: true }); } catch { /* best effort */ }
}

export async function trustTunnelStatus(): Promise<TrustTunnelStatus> {
  if (process.platform !== "win32" || busy) return current;
  const svc = await trustTunnelServiceState();
  if (svc === "running") return emit({ state: "on", error: null });
  if (svc === "pending") return emit({ state: "connecting", error: null });
  if (svc === "unknown") return emit({ state: "error", error: "Не удалось проверить службу TrustTunnel." });
  if (svc === "stopped") return emit({ state: "error", error: "Служба TrustTunnel остановлена. Отключите её перед повторным подключением." });
  if (current.state === "on" || current.state === "connecting") {
    return emit({ state: "error", error: "Служба TrustTunnel остановилась. Включите соединение снова." });
  }
  return current;
}

export async function isTrustTunnelActive(): Promise<boolean> {
  const svc = await trustTunnelServiceState();
  return svc !== "absent";
}

export async function trustTunnelUp(profile: unknown): Promise<TrustTunnelStatus> {
  const release = acquireVpnStart();
  if (!release) return { state: "error", error: "Другое VPN-подключение запускается", supported: process.platform === "win32" };
  try { return await trustTunnelUpInternal(profile); } finally { release(); }
}

async function trustTunnelUpInternal(profile: unknown): Promise<TrustTunnelStatus> {
  if (process.platform !== "win32") return emit({ state: "error", error: "TrustTunnel в этой версии поддерживается только на Windows" });
  if (busy) return current;
  if (!isValidTrustTunnelProfile(profile)) return emit({ state: "error", error: "Профиль TrustTunnel повреждён" });
  if (await isVpnActive()) return emit({ state: "error", error: "Сначала отключите обычный VPN TrioZ" });
  const dir = trustTunnelClientDir();
  if (!existsSync(dir) || !clientFilesOk(dir)) {
    return emit({ state: "error", error: TT_EXIT[26] });
  }
  busy = true;
  emit({ state: "connecting", error: null });
  try {
    const pending = pendingPath();
    mkdirSync(join(app.getPath("userData"), "trusttunnel"), { recursive: true });
    writeFileSync(pending, profile, { mode: 0o600 });
    const code = await elevatedScript(buildUpScript(dir, pending));
    if (code !== 0) throw new Error(TT_EXIT[code] || `Не удалось включить TrustTunnel (код ${code})`);
    busy = false;
    const svc = await trustTunnelServiceState();
    if (svc !== "running") throw new Error(TT_EXIT[24]);
    return emit({ state: "on", error: null });
  } catch (err) {
    return emit({ state: "error", error: err instanceof Error ? err.message : "Не удалось включить TrustTunnel" });
  } finally {
    busy = false;
    removePending();
  }
}

export async function trustTunnelDown(): Promise<TrustTunnelStatus> {
  if (process.platform !== "win32") return emit({ state: "off", error: null });
  if (busy) return current;
  busy = true;
  emit({ state: "disconnecting", error: null });
  try {
    if ((await trustTunnelServiceState()) !== "absent") {
      const code = await elevatedScript(buildDownScript());
      if (code !== 0) throw new Error("Не удалось отключить TrustTunnel");
    }
    busy = false;
    if ((await trustTunnelServiceState()) !== "absent") throw new Error("Служба TrustTunnel ещё не удалена — повторите отключение");
    return emit({ state: "off", error: null });
  } catch (err) {
    return emit({ state: "error", error: err instanceof Error ? err.message : "Не удалось отключить TrustTunnel" });
  } finally {
    busy = false;
    removePending();
  }
}

/** before-quit: never leave a full-tunnel service running without its UI. */
export async function shutdownTrustTunnel(): Promise<void> {
  removePending();
  try {
    if (await isTrustTunnelActive()) await trustTunnelDown();
  } catch { /* nothing to show any more */ }
}

/** Startup: reflect a service that survived a crash/update; never auto-elevate. */
export async function refreshTrustTunnelOnStart(): Promise<void> {
  removePending();
  await trustTunnelStatus();
}
