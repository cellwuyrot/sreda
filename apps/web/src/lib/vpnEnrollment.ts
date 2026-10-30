import { getAndroidVpnBridge } from "@/lib/androidVpn";
import { deviceKeyPair } from "@/lib/wgIdentity";
/** Android profiles contain a placeholder only. Native code supplies the account-scoped secret. */
export async function vpnEnrollmentKeys() {
  const android = getAndroidVpnBridge();
  if (!android) return deviceKeyPair();
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  const session = response.ok ? await response.json() : null;
  const id = session?.user?.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw new Error("Войдите в аккаунт перед подключением VPN");
  return {
    publicKey: await android.publicKey(id),
    privateKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  };
}
export async function waitForAndroidPeer(): Promise<void> {
  if (!getAndroidVpnBridge()) return;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch("/api/vpn/me", {
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      if (r.status === 401 || r.status === 403)
        return Promise.reject(new Error("Доступ VPN отозван"));
      const data = r.ok ? await r.json() : null;
      if (data?.peerApplied === true) return;
    } catch {
      /* Network failures get a bounded retry before any routes change. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(
    "Сервер ещё не применил доступ. Повторите подключение через минуту.",
  );
}
