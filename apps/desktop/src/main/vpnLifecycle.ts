import type { VpnStatePayload } from "../shared/vpnPlan";

/**
 * Решение о cleanup нельзя принимать только по памяти Electron: `error`/`off`
 * совместимы с реально оставшейся Windows-службой после crash/partial start.
 */
export function vpnNeedsCleanup(state: VpnStatePayload["state"], physicalTunnelExists: boolean): boolean {
  return (
    state === "on" ||
    state === "connecting" ||
    state === "disconnecting" ||
    physicalTunnelExists
  );
}

/** Ошибка подключения не должна маскироваться вторичной ошибкой cleanup. */
export async function cleanupAfterFailedStart(cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup();
  } catch {
    /* исходная ошибка vpnUp важнее; следующий запуск/exit повторит recovery */
  }
}

/** Оркестратор before-quit: завершение продолжается только после cleanup. */
export async function cleanupVpnBeforeExit(
  isActive: () => Promise<boolean>,
  cleanup: () => Promise<void>,
): Promise<void> {
  if (await isActive()) await cleanup();
}