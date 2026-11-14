/**
 * TRUSTTUNNEL-WIN: pure helpers for the Windows TrustTunnel engine.
 *
 * Model (mirrors the existing AmneziaWG flow in main/winTunnel.ts: one UAC
 * prompt per connect and per disconnect, no permanent privileged listener):
 *
 *  1. Main process validates the server profile (exact template) and writes
 *     it to the user's own profile directory (%APPDATA%, user-only ACL).
 *  2. ONE elevated PowerShell script: re-validates the profile line by line,
 *     deletes the user copy, creates %ProgramData%\TrioZTrustTunnel with an
 *     ACL of SYSTEM + Administrators only, copies the vendored client from the
 *     per-machine install dir, verifies pinned SHA-256 hashes, writes
 *     client.toml there and registers OUR OWN on-demand service
 *     `TrioZTrustTunnel` (never the upstream global `TrustTunnelClient`) as
 *     `"trusttunnel_client.exe" --service-run --config "client.toml"`.
 *  3. Disconnect: stop + delete the service and delete client.toml (the
 *     password does not remain on disk).
 *
 * The upstream `vpn_easy_service` named pipe (Authenticated Users RW + any
 * privileged TOML) is NOT used.
 */
import { TRUSTTUNNEL_PROFILE_LINES } from "./trustTunnelPilotProfile";

export const TT_SERVICE_NAME = "TrioZTrustTunnel";
export const TT_CLIENT_VERSION = "1.1.12";
/** SHA-256 of files from trusttunnel_client-v1.1.12-windows-x86_64.zip
 * (zip SHA-256 56fb620f4cd30abbc1b4586c6645b56d90c8c0e977ba53d95fb0f542acb7cb1f). */
export const TT_FILES: ReadonlyArray<{ name: string; sha256: string }> = [
  { name: "trusttunnel_client.exe", sha256: "5cf4c9c5c19bc5fce03f4b37b97c23c3b819f6a08de778a1df71180358226765" },
  { name: "wintun.dll", sha256: "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce" },
];

/** Exit codes of the elevated scripts → user-facing Russian messages. */
export const TT_EXIT: Record<number, string> = {
  20: "Профиль подключения не найден — повторите включение",
  21: "Профиль подключения отклонён проверкой безопасности",
  22: "Не удалось защитить служебный каталог TrustTunnel",
  23: "Файлы клиента TrustTunnel повреждены или подменены — переустановите приложение",
  24: "Служба TrustTunnel не запустилась",
  25: "Не удалось установить службу TrustTunnel",
  26: "Клиент TrustTunnel не найден в установке — переустановите приложение",
};

export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function psExpectedArray(): string {
  return "@(" + TRUSTTUNNEL_PROFILE_LINES.map((l) => (l === null ? "$null" : psQuote(l))).join(", ") + ")";
}

/** Reject anything that could break out of a PowerShell single-quoted path. */
export function isSafeWindowsPath(p: string): boolean {
  return typeof p === "string" && p.length > 3 && p.length < 260 && /^[A-Za-z]:\\/.test(p) &&
    !/[\r\n\0"`$<>|*?]/.test(p);
}

export function buildUpScript(clientDir: string, pendingPath: string): string {
  if (!isSafeWindowsPath(clientDir) || !isSafeWindowsPath(pendingPath)) throw new Error("unsafe path");
  const hashes = TT_FILES.map((f) => `@{ n = ${psQuote(f.name)}; h = ${psQuote(f.sha256.toUpperCase())} }`).join(", ");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$svc = ${psQuote(TT_SERVICE_NAME)}`,
    `$src = ${psQuote(clientDir)}`,
    `$pending = ${psQuote(pendingPath)}`,
    "$dst = Join-Path $env:ProgramData 'TrioZTrustTunnel'",
    `$files = @(${hashes})`,
    `$expected = ${psExpectedArray()}`,
    "try {",
    "  if (-not (Test-Path -LiteralPath $pending -PathType Leaf)) { exit 20 }",
    "  if ((Get-Item -LiteralPath $pending).Length -gt 4096) { Remove-Item -LiteralPath $pending -Force; exit 21 }",
    "  $cfg = [IO.File]::ReadAllText($pending)",
    "  Remove-Item -LiteralPath $pending -Force",
    "  if ($cfg.Contains(\"`r\")) { exit 21 }",
    "  $lines = $cfg -split \"`n\"",
    "  if ($lines.Count -ne $expected.Count) { exit 21 }",
    "  for ($i = 0; $i -lt $lines.Count; $i++) {",
    "    if ($i -eq 7) { if ($lines[$i] -cnotmatch '^username = \"trioz_[a-f0-9]{32}\"$') { exit 21 } }",
    "    elseif ($i -eq 8) { if ($lines[$i] -cnotmatch '^password = \"[A-Za-z0-9_-]{43}\"$') { exit 21 } }",
    "    elseif ($lines[$i] -cne $expected[$i]) { exit 21 }",
    "  }",
    "  foreach ($f in $files) { if (-not (Test-Path -LiteralPath (Join-Path $src $f.n) -PathType Leaf)) { exit 26 } }",
    "  $old = Get-Service -Name $svc -ErrorAction SilentlyContinue",
    "  if ($old) {",
    "    if ($old.Status -ne 'Stopped') { & sc.exe stop $svc | Out-Null }",
    "    for ($i = 0; $i -lt 40; $i++) { $s = Get-Service -Name $svc -ErrorAction SilentlyContinue; if (-not $s -or $s.Status -eq 'Stopped') { break }; Start-Sleep -Milliseconds 500 }",
    "    & sc.exe delete $svc | Out-Null",
    "    Start-Sleep -Milliseconds 700",
    "  }",
    "  if (Test-Path -LiteralPath $dst) { if ((Get-Item -LiteralPath $dst -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 22 } }",
    "  New-Item -ItemType Directory -Force -Path $dst | Out-Null",
    "  if ((Get-Item -LiteralPath $dst -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 22 }",
    "  $acl = New-Object System.Security.AccessControl.DirectorySecurity",
    "  $acl.SetAccessRuleProtection($true, $false)",
    "  $system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')",
    "  $admins = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')",
    "  $acl.SetOwner($admins)",
    "  foreach ($sid in @($system, $admins)) { $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'); $acl.AddAccessRule($rule) }",
    "  Set-Acl -LiteralPath $dst -AclObject $acl",
    "  foreach ($name in @('trusttunnel_client.exe', 'wintun.dll', 'client.toml')) { $path = Join-Path $dst $name; if (Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue) { if ((Get-Item -LiteralPath $path -Force).PSIsContainer) { exit 22 }; Remove-Item -LiteralPath $path -Force } }",
    "  foreach ($f in $files) {",
    "    $target = Join-Path $dst $f.n",
    "    Copy-Item -LiteralPath (Join-Path $src $f.n) -Destination $target -Force",
    "    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash -ne $f.h) { Remove-Item -LiteralPath $target -Force; exit 23 }",
    "  }",
    "  $conf = Join-Path $dst 'client.toml'",
    "  [IO.File]::WriteAllText($conf, $cfg, (New-Object System.Text.UTF8Encoding($false)))",
    "  $exe = Join-Path $dst 'trusttunnel_client.exe'",
    "  $bin = '\"' + $exe + '\" --service-run --config \"' + $conf + '\"'",
    "  try { New-Service -Name $svc -BinaryPathName $bin -DisplayName 'TrioZ TrustTunnel' -Description 'TrioZ Connect: Надёжное соединение (TrustTunnel)' -StartupType Manual | Out-Null } catch { Remove-Item -LiteralPath $conf -Force -ErrorAction SilentlyContinue; exit 25 }",
    "  try { Start-Service -Name $svc } catch { }",
    "  for ($i = 0; $i -lt 40; $i++) { if ((Get-Service -Name $svc).Status -eq 'Running') { exit 0 }; Start-Sleep -Milliseconds 500 }",
    "  & sc.exe stop $svc | Out-Null; Start-Sleep -Seconds 2; & sc.exe delete $svc | Out-Null",
    "  Remove-Item -LiteralPath $conf -Force -ErrorAction SilentlyContinue",
    "  exit 24",
    "} catch {",
    "  if ($pending -and (Test-Path -LiteralPath $pending)) { Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue }",
    "  exit 25",
    "}",
  ].join("\r\n");
}

export function buildDownScript(): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$svc = ${psQuote(TT_SERVICE_NAME)}`,
    "$dst = Join-Path $env:ProgramData 'TrioZTrustTunnel'",
    "$s = Get-Service -Name $svc",
    "if ($s) {",
    "  if ($s.Status -ne 'Stopped') { & sc.exe stop $svc | Out-Null }",
    "  for ($i = 0; $i -lt 40; $i++) { $s = Get-Service -Name $svc; if (-not $s -or $s.Status -eq 'Stopped') { break }; Start-Sleep -Milliseconds 500 }",
    "  if ($s -and $s.Status -ne 'Stopped') { Get-CimInstance Win32_Service -Filter \"Name='TrioZTrustTunnel'\" | ForEach-Object { if ($_.ProcessId) { Stop-Process -Id $_.ProcessId -Force } } }",
    "  & sc.exe delete $svc | Out-Null",
    "}",
    "if ((Test-Path -LiteralPath $dst) -and -not ((Get-Item -LiteralPath $dst -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-Item -LiteralPath (Join-Path $dst 'client.toml') -Force }",
    "exit 0",
  ].join("\r\n");
}

/** `sc query` output → coarse state; no admin rights needed. */
export function parseScQuery(stdout: string): "running" | "pending" | "stopped" | "absent" | "unknown" {
  if (/STATE\s*:\s*4\s+RUNNING/i.test(stdout)) return "running";
  if (/STATE\s*:\s*[2356]\s/i.test(stdout)) return "pending";
  if (/STATE\s*:\s*1\s+STOPPED/i.test(stdout)) return "stopped";
  if (/\b1060\b/.test(stdout)) return "absent";
  return "unknown";
}
