import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Configure "launch on login".
 *
 * Windows and macOS have a first-class API (`setLoginItemSettings`). Linux has
 * no such API, so we follow the XDG autostart convention and drop a `.desktop`
 * file into `~/.config/autostart`.
 */
export function applyAutoLaunch(enabled: boolean): void {
  if (process.platform === "linux") {
    applyLinuxAutostart(enabled);
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true, // start minimized to the tray
  });
}

function applyLinuxAutostart(enabled: boolean): void {
  const dir = path.join(os.homedir(), ".config", "autostart");
  const file = path.join(dir, "trioz-connect.desktop");
  try {
    if (!enabled) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    const exec = app.isPackaged ? process.execPath : `${process.execPath} ${path.resolve(process.argv[1] ?? "")}`;
    const entry = [
      "[Desktop Entry]",
      "Type=Application",
      "Name=TrioZ Connect",
      `Exec=${exec} --hidden`,
      "X-GNOME-Autostart-enabled=true",
      "Terminal=false",
      "",
    ].join("\n");
    fs.writeFileSync(file, entry, "utf8");
  } catch (err) {
    console.warn("[autoLaunch] linux autostart failed:", err);
  }
}
