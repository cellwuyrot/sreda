/** This release deliberately supports one realtime process. Redis counters
 * and task locks are not a Socket.IO adapter or distributed voice state. */
export function assertSingleRealtimeInstance(env: Record<string, string | undefined>): void {
  for (const name of ["WEB_CONCURRENCY", "REALTIME_REPLICAS"]) {
    if (Number(env[name] || 1) !== 1) throw new Error(`${name}: this release requires exactly one realtime instance`);
  }
  if (env.NODE_APP_INSTANCE && env.NODE_APP_INSTANCE !== "0") throw new Error("Realtime clustering is not supported");
}
