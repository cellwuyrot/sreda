import { describe, it, expect, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }>);
vi.mock("node:child_process", () => ({
  execFile: (file: string, args: string[], options: Record<string, unknown>, callback: (err: null, result: string) => void) => {
    calls.push({ file, args, options });
    callback(null, "");
  },
}));
vi.mock("node:fs", () => ({ existsSync: () => false, readFileSync: vi.fn() }));
import { windowsTunnelDown } from "./winTunnel";

describe("Windows: скрытый запуск без обхода UAC", () => {
  it("скрывает оба PowerShell и сохраняет RunAs и закодированный сценарий", async () => {
    await windowsTunnelDown("");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.file).toBe("powershell.exe");
    expect(call.options.windowsHide).toBe(true);
    expect(call.args).toContain("-WindowStyle");
    expect(call.args).toContain("Hidden");
    const outer = call.args[call.args.length - 1];
    expect(outer).toContain("-Verb RunAs -WindowStyle Hidden -Wait -PassThru");
    expect(outer).toContain("-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand");
    const encoded = outer.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1];
    expect(encoded).toBeTruthy();
    const script = Buffer.from(encoded!, "base64").toString("utf16le");
    expect(script).toContain("amneziawg.exe");
    expect(script).toContain("/uninstalltunnelservice");
    expect(script).not.toContain("Set-NetFirewall");
  });
});
