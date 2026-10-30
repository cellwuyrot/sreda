import { getDesktopApi, type DesktopVpnApi } from "@/lib/desktop";
import { getAndroidVpnBridge, type AndroidVpnApi } from "@/lib/androidVpn";
/** No desktop-shaped globals are fabricated on Android. */
export function getVpnBridge(): DesktopVpnApi | AndroidVpnApi | null {
  return getAndroidVpnBridge() ?? getDesktopApi()?.vpn ?? null;
}
