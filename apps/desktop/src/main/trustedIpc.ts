import { ipcMain as rawIpc, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { getConfig } from "./config";
import { getMainWindow } from "./mainWindow";
import { trustedAppFrame } from "../shared/ipcTrust";
import { IPC } from "../shared/constants";

const overlayChannels = new Set<string>([IPC.OVERLAY_ACTION, IPC.OVERLAY_RESIZE, IPC.OVERLAY_MOVE_START, IPC.OVERLAY_MOVE, IPC.OVERLAY_MOVE_END]);
const overlayUrl = pathToFileURL(path.join(__dirname, "../../static/overlay/index.html")).href;
function trusted(event: IpcMainEvent | IpcMainInvokeEvent, channel: string): boolean {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  const url = frame.url;
  if (overlayChannels.has(channel) && url.split(/[?#]/)[0] === overlayUrl) return true;
  return event.sender === getMainWindow()?.webContents && trustedAppFrame(url, true, getConfig().appUrl);
}

export const trustedIpc = {
  handle<Args extends unknown[], Result>(channel: string, listener: (event: IpcMainInvokeEvent, ...args: Args) => Result): void {
    rawIpc.handle(channel, (event, ...args) => {
      if (!trusted(event, channel)) throw new Error("Untrusted IPC sender");
      return listener(event, ...args as Args);
    });
  },
  on<Args extends unknown[]>(channel: string, listener: (event: IpcMainEvent, ...args: Args) => void): void {
    rawIpc.on(channel, (event, ...args) => {
      if (trusted(event, channel)) listener(event, ...args as Args);
    });
  },
};
