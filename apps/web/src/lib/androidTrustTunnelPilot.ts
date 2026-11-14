/** Debug-only Android pilot bridge. Profile values must never be logged or persisted. */
interface PilotPort { postMessage(message: string): void; onmessage: ((event: { data: string }) => void) | null }
declare global { interface Window { TriozTrustTunnelPilotBridge?: PilotPort } }
export type PilotStatus = { state: 'off' | 'connecting' | 'on' | 'disconnecting' | 'error'; error: string | null };
let sequence = 0;
let active: PilotPort | undefined;
const pending = new Map<string, { resolve: (value: PilotStatus) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
export function getAndroidTrustTunnelPilot() {
  if (typeof window === 'undefined' || !window.TriozTrustTunnelPilotBridge?.postMessage) return null;
  const port = window.TriozTrustTunnelPilotBridge;
  if (active !== port) {
    active = port;
    port.onmessage = event => {
      try {
        const data = JSON.parse(event.data); const call = pending.get(data.id);
        if (!call) return;
        pending.delete(data.id); clearTimeout(call.timer);
        if (typeof data.error === 'string') { call.reject(new Error(data.error)); return; }
        const result = data.result;
        if (!result || !['off','connecting','on','disconnecting','error'].includes(result.state) || !(result.error === null || typeof result.error === 'string')) {
          call.reject(new Error('Некорректный ответ VPN')); return;
        }
        call.resolve({ state: result.state, error: result.error });
      } catch { /* Invalid response ignored; request will time out. */ }
    };
  }
  function request(op: string, config?: string): Promise<PilotStatus> {
    return new Promise((resolve, reject) => {
      const id = `tt-${++sequence}`;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Android VPN не ответил')); }, 15000);
      pending.set(id, { resolve, reject, timer });
      try { port!.postMessage(JSON.stringify({ id, op, ...(config === undefined ? {} : { config }) })); }
      catch { clearTimeout(timer); pending.delete(id); reject(new Error('Не удалось обратиться к Android VPN')); }
    });
  }
  return { status: () => request('status'), up: (config: string) => request('up', config), down: () => request('down') };
}
