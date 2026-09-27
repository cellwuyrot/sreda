/** Physical IPv4 uplink, never a virtual tunnel or a UI online flag. */
export interface PhysicalRoute {
  interfaceIndex: number;
  interfaceAlias: string;
  localAddress: string;
  gateway: string;
  dnsServers: string[];
}
export interface EndpointRoute { ip: string; interfaceIndex: number; gateway: string; }

export function routeChanged(a: PhysicalRoute, b: PhysicalRoute): boolean {
  return a.interfaceIndex !== b.interfaceIndex || a.gateway !== b.gateway ||
    a.localAddress !== b.localAddress || a.dnsServers.join(',') !== b.dnsServers.join(',');
}

export interface HandoffRuntime {
  physical(): Promise<PhysicalRoute | null>;
  ready(route: PhysicalRoute): Promise<boolean>;
  recover(route: PhysicalRoute, cancelled: () => boolean): Promise<boolean>;
  active(): boolean;
  status(message: string, failed?: boolean): void;
  log(message: string): void;
  sleep(ms: number): Promise<void>;
}

/** Serializes handoffs, including an outage with no default route, with a bounded retry budget. */
export class NetworkHandoff {
  private baseline: PhysicalRoute | null = null;
  private generation = 0;
  private running: Promise<void> | null = null;
  private lastFailure = '';
  constructor(private readonly io: HandoffRuntime) {}

  setBaseline(route: PhysicalRoute): void { this.baseline = route; this.lastFailure = ''; }
  getBaseline(): PhysicalRoute | null { return this.baseline; }
  cancel(): Promise<void> {
    this.generation++;
    this.baseline = null;
    this.lastFailure = '';
    return this.running ?? Promise.resolve();
  }
  async scan(): Promise<void> {
    if (!this.io.active() || !this.baseline) return;
    const next = await this.io.physical();
    if (next && !routeChanged(this.baseline, next)) return;
    // A disconnected uplink is not yet a new one. Keep baseline until the replacement is ready.
    if (this.lastFailure === (next ? JSON.stringify(next) : 'NO_ROUTE')) return;
    if (this.running) return;
    const token = ++this.generation;
    this.running = this.run(token).finally(() => { this.running = null; });
    await this.running;
  }
  private async run(token: number): Promise<void> {
    this.io.log('NETWORK_CHANGED');
    this.io.status('VPN: переподключение...');
    await this.io.sleep(1500); // debounce Windows route/profile event bursts
    const cancelled = () => token !== this.generation || !this.io.active();
    if (cancelled()) return;
    let route: PhysicalRoute | null = null;
    const deadline = Date.now() + 30_000;
    while (!cancelled() && Date.now() < deadline) {
      route = await this.io.physical();
      if (route && await this.io.ready(route)) break;
      route = null;
      await this.io.sleep(1000);
    }
    if (cancelled()) return;
    if (!route) { this.lastFailure = 'NO_ROUTE'; this.io.log('RECOVERY_FAILED: no usable gateway'); this.io.status('VPN: новая сеть не готова (нет доступного шлюза)', true); return; }
    if (!this.baseline) return; // cancellation cleared the desired connection
    this.io.log(`OLD_INTERFACE=${this.baseline.interfaceAlias}#${this.baseline.interfaceIndex} OLD_GATEWAY=${this.baseline.gateway}`);
    this.io.log(`NEW_INTERFACE=${route.interfaceAlias}#${route.interfaceIndex} NEW_GATEWAY=${route.gateway}`);
    for (let attempt = 0; attempt < 3 && !cancelled(); attempt++) {
      try {
        const success = await this.io.recover(route, cancelled);
        if (cancelled()) return;
        if (success) { this.baseline = route; this.lastFailure = ''; this.io.log('RECOVERY_SUCCESS'); return; }
        throw new Error('нет подтверждённого handshake или доступа к VPN-узлу');
      } catch (error) {
        this.io.log(`RECOVERY_FAILED attempt=${attempt + 1}: ${String(error)}`);
        if (attempt === 2) {
          this.lastFailure = JSON.stringify(route);
          this.io.status(`VPN: восстановление не удалось: ${error instanceof Error ? error.message : String(error)}`, true);
        } else {
          await this.io.sleep(2000 * 2 ** attempt);
          const latest = await this.io.physical();
          if (latest && routeChanged(route, latest)) { this.lastFailure = ''; return; } // new scan gets a fresh budget
        }
      }
    }
  }
}
