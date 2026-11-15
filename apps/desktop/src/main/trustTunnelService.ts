/** Read the local TrioZ TrustTunnel service without elevation or network access. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseScQuery, TT_SERVICE_NAME } from "../shared/trustTunnelWin";

const run = promisify(execFile);
export type ServiceState = "running" | "pending" | "stopped" | "absent" | "unknown";
type Runner = (program: string, args: string[], options: { windowsHide: boolean; timeout: number }) => Promise<{ stdout: string }>;

// Use a fixed ASCII marker and the ServiceControllerStatus numeric value. Unlike
// sc.exe's user-facing output this is independent of the Windows UI language or
// console codepage. A failure to query is never interpreted as an absent service.
export const SERVICE_PROBE = [
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "  $services = [System.ServiceProcess.ServiceController]::GetServices()",
  `  $s = $services | Where-Object { $_.ServiceName -eq '${TT_SERVICE_NAME}' } | Select-Object -First 1`,
  "  if ($null -eq $s) { [Console]::Out.WriteLine('TRIOZ_TT_STATE=ABSENT') }",
  "  else { $s.Refresh(); [Console]::Out.WriteLine('TRIOZ_TT_STATE=' + [int]$s.Status) }",
  "} catch { [Console]::Out.WriteLine('TRIOZ_TT_STATE=UNKNOWN'); exit 1 }",
].join("\n");

export function parseServiceProbe(output: string): ServiceState {
  const match = output.match(/^TRIOZ_TT_STATE=(ABSENT|[1-7])\s*$/m);
  if (!match) return "unknown";
  if (match[1] === "ABSENT") return "absent";
  if (match[1] === "4") return "running";
  if (match[1] === "1") return "stopped";
  if (["2", "3", "5", "6"].includes(match[1])) return "pending";
  return "unknown";
}

/** A failed primary query falls back to sc, but two failures remain unknown. */
export async function probeTrustTunnelService(runner: Runner): Promise<ServiceState> {
  const options = { windowsHide: true, timeout: 10_000 };
  try {
    const { stdout } = await runner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SERVICE_PROBE], options);
    const result = parseServiceProbe(stdout);
    if (result !== "unknown") return result;
  } catch { /* fall back; errors do not mean the service is absent */ }
  try {
    const { stdout } = await runner("sc.exe", ["query", TT_SERVICE_NAME], options);
    return parseScQuery(stdout);
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return parseScQuery(`${err.stdout ?? ""} ${err.stderr ?? ""}`);
  }
}

export async function trustTunnelServiceState(): Promise<ServiceState> {
  if (process.platform !== "win32") return "absent";
  return probeTrustTunnelService(async (program, args, options) => {
    const { stdout } = await run(program, args, options);
    return { stdout };
  });
}
