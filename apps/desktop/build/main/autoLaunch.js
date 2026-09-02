"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAutoLaunch = applyAutoLaunch;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
/**
 * Configure "launch on login".
 *
 * Windows and macOS have a first-class API (`setLoginItemSettings`). Linux has
 * no such API, so we follow the XDG autostart convention and drop a `.desktop`
 * file into `~/.config/autostart`.
 */
function applyAutoLaunch(enabled) {
    if (process.platform === "linux") {
        applyLinuxAutostart(enabled);
        return;
    }
    electron_1.app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true, // start minimized to the tray
    });
}
function applyLinuxAutostart(enabled) {
    const dir = path_1.default.join(os_1.default.homedir(), ".config", "autostart");
    const file = path_1.default.join(dir, "trioz-connect.desktop");
    try {
        if (!enabled) {
            if (fs_1.default.existsSync(file))
                fs_1.default.unlinkSync(file);
            return;
        }
        fs_1.default.mkdirSync(dir, { recursive: true });
        const exec = electron_1.app.isPackaged ? process.execPath : `${process.execPath} ${path_1.default.resolve(process.argv[1] ?? "")}`;
        const entry = [
            "[Desktop Entry]",
            "Type=Application",
            "Name=TrioZ Connect",
            `Exec=${exec} --hidden`,
            "X-GNOME-Autostart-enabled=true",
            "Terminal=false",
            "",
        ].join("\n");
        fs_1.default.writeFileSync(file, entry, "utf8");
    }
    catch (err) {
        console.warn("[autoLaunch] linux autostart failed:", err);
    }
}
//# sourceMappingURL=autoLaunch.js.map