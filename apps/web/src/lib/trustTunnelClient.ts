import { getAndroidTrustTunnelPilot, type PilotStatus } from './androidTrustTunnelPilot';
import { getDesktopApi } from './desktop';

export interface TrustTunnelEngine {
  status(): Promise<PilotStatus>;
  up(config: string): Promise<PilotStatus>;
  down(): Promise<PilotStatus>;
}
/** Only native bridges on supported platforms may receive private profiles. */
export function getTrustTunnelEngine(): TrustTunnelEngine | null {
  const android = getAndroidTrustTunnelPilot();
  if (android) return android;
  const desktop = getDesktopApi();
  return desktop?.platform === 'win32' ? desktop.trustTunnel ?? null : null;
}
