import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDownScript, buildUpScript, isSafeWindowsPath, parseScQuery, TT_EXIT, TT_FILES, TT_SERVICE_NAME } from "./trustTunnelWin";

const dir = "C:\\Program Files\\TrioZ Connect\\resources\\trusttunnel";
const pending = "C:\\Users\\andy\\AppData\\Roaming\\TrioZ Connect\\trusttunnel\\pending.toml";

describe("Windows TrustTunnel elevated scripts", () => {
  it("uses our own on-demand service, never the upstream global one or its pipe", () => {
    const s = buildUpScript(dir, pending);
    expect(TT_SERVICE_NAME).toBe("TrioZTrustTunnel");
    expect(s).toContain("--service-run --config");
    expect(s).toContain("-StartupType Manual");
    expect(s).not.toMatch(/'TrustTunnelClient'|service-install|vpn_easy/);
  });
  it("re-validates the profile, deletes the user copy and protects the target dir", () => {
    const s = buildUpScript(dir, pending);
    expect(s.indexOf("Remove-Item -LiteralPath $pending")).toBeLessThan(s.indexOf("New-Service"));
    expect(s).toContain("'^password = \"[A-Za-z0-9_-]{43}\"$'");
    expect(s).toContain("'hostname = \"turn.trioz.ru\"'");
    expect(s).toContain("$acl.SetAccessRuleProtection($true, $false)");
    expect(s).toContain("$acl.SetOwner($admins)");
    expect(s).toContain("ReparsePoint");
    for (const f of TT_FILES) expect(s).toContain(f.sha256.toUpperCase());
  });
  it("quotes paths with apostrophes and rejects injection-capable paths", () => {
    expect(buildUpScript("C:\\Users\\O'Brien\\x", pending)).toContain("'C:\\Users\\O''Brien\\x'");
    for (const bad of ["C:\\x\"; calc", "C:\\x`n", "\\\\server\\share", "C:\\$env:x", "relative\\p"]) {
      expect(isSafeWindowsPath(bad)).toBe(false);
      expect(() => buildUpScript(bad, pending)).toThrow();
    }
  });
  it("disconnect removes the service and the stored profile", () => {
    const s = buildDownScript();
    expect(s).toContain("sc.exe delete $svc");
    expect(s).toContain("'client.toml'");
  });
  it("maps every elevated exit code used by the script to a message", () => {
    const codes = [...buildUpScript(dir, pending).matchAll(/exit (\d+)/g)].map((m) => Number(m[1])).filter((c) => c !== 0);
    for (const c of codes) expect(TT_EXIT[c]).toBeTruthy();
  });
  it("parses sc query output", () => {
    expect(parseScQuery("SERVICE_NAME: TrioZTrustTunnel\n        STATE              : 4  RUNNING")).toBe("running");
    expect(parseScQuery("        STATE              : 2  START_PENDING")).toBe("pending");
    expect(parseScQuery("        STATE              : 1  STOPPED")).toBe("stopped");
    expect(parseScQuery("[SC] EnumQueryServicesStatus:OpenService FAILED 1060")).toBe("absent");
    expect(parseScQuery("Access denied")).toBe("unknown");
  });
  it("pinned hashes match the vendored client when present", () => {
    const vendored = join(__dirname, "..", "..", "resources", "trusttunnel", "win32");
    if (!existsSync(vendored)) return;
    for (const f of TT_FILES) expect(createHash("sha256").update(readFileSync(join(vendored, f.name))).digest("hex")).toBe(f.sha256);
  });
});
