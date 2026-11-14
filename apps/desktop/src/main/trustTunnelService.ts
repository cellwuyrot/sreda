/** TRUSTTUNNEL-WIN: read-only service probe (no admin rights, no other imports to avoid cycles). */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseScQuery, TT_SERVICE_NAME } from "../shared/trustTunnelWin";

const run = promisify(execFile);

export async function trustTunnelServiceState(): Promise<ReturnType<typeof parseScQuery>> {
  if (process.platform !== "win32") return "absent";
  try {
    const { stdout } = await run("sc.exe", ["query", TT_SERVICE_NAME], { windowsHide: true, timeout: 10_000 });
    return parseScQuery(stdout);
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return parseScQuery(`${err.stdout ?? ""} ${err.stderr ?? ""}`);
  }
}
