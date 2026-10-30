/** Android VPN protocol v2. Main-frame origin-checked WebMessage bridge, never a JS private key. */
import type { DesktopVpnApi, DesktopVpnState } from "@/lib/desktop";
interface AndroidMessagePort {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}
declare global {
  interface Window {
    TriozVpnBridge?: AndroidMessagePort;
    __androidVpnState?: (json: string) => void;
  }
}
export interface AndroidVpnApi extends DesktopVpnApi {
  publicKey(account: string): Promise<string>;
  admission(): Promise<{ allowed: boolean; message: string; version: number }>;
}
const listeners = new Set<(state: DesktopVpnState) => void>();
let sequence = 0;
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let activePort: AndroidMessagePort | undefined;
function validState(value: unknown): value is DesktopVpnState {
  return (
    !!value &&
    typeof value === "object" &&
    "state" in value &&
    ["off", "on", "connecting", "disconnecting", "error"].includes(
      String(value.state),
    )
  );
}
function request<T>(
  op: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const port = window.TriozVpnBridge;
    if (!port?.postMessage) {
      reject(new Error("Обновите Android-приложение и Android System WebView"));
      return;
    }
    const id = `vpn-${++sequence}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Android VPN не ответил. Повторите попытку."));
    }, 15000);
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    try {
      port.postMessage(JSON.stringify({ id, op, ...args }));
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error("Не удалось вызвать Android VPN"));
    }
  });
}
export function getAndroidVpnBridge(): AndroidVpnApi | null {
  if (
    typeof window === "undefined" ||
    typeof window.TriozVpnBridge?.postMessage !== "function"
  )
    return null;
  const port = window.TriozVpnBridge;
  if (activePort !== port) {
    activePort = port;
    port.onmessage = (event) => {
      try {
        const reply = JSON.parse(event.data);
        const call = pending.get(reply.id);
        if (!call) return;
        pending.delete(reply.id);
        clearTimeout(call.timer);
        if (typeof reply.error === "string")
          call.reject(new Error(reply.error));
        else call.resolve(reply.result);
      } catch {
        /* Never execute data arriving from the native bridge. */
      }
    };
  }
  window.__androidVpnState = (json) => {
    try {
      const state: unknown = JSON.parse(json);
      if (validState(state)) listeners.forEach((fn) => fn(state));
    } catch {
      /* Invalid state ignored. */
    }
  };
  const stateRequest = async (op: string, args?: Record<string, unknown>) => {
    const state = await request<unknown>(op, args);
    if (!validState(state))
      throw new Error("Некорректное состояние Android VPN");
    return state;
  };
  return {
    up: (config) => stateRequest("up", { config }),
    down: () => stateRequest("down"),
    status: () => stateRequest("status"),
    onState: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    publicKey: async (account: string) => {
      const key = await request<unknown>("publicKey", { account });
      if (typeof key !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(key))
        throw new Error("Некорректный публичный ключ Android");
      return key;
    },
    admission: () => request("admission"),
  };
}
