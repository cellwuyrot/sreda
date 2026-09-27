/** Windows-only physical uplink and owned IPv4 endpoint route. No generic WireGuard service. */
import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import type { PhysicalRoute, EndpointRoute } from './networkHandoff';
const run = promisify(execFile);
const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;
async function ps(script: string): Promise<string> {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

/** /0 route alone is insufficient: require an Up non-VPN uplink, IPv4 and gateway. */
export async function physicalRoute(): Promise<PhysicalRoute | null> {
  const script = `
$ErrorActionPreference = 'Stop'
$routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -PolicyStore ActiveStore |
  Where-Object { $_.NextHop -ne '0.0.0.0' } |
  Sort-Object { $_.RouteMetric + (Get-NetIPInterface -AddressFamily IPv4 -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty InterfaceMetric) }
foreach ($r in $routes) {
  $a = Get-NetAdapter -InterfaceIndex $r.InterfaceIndex -ErrorAction SilentlyContinue
  if (-not $a -or $a.Status -ne 'Up' -or $a.Name -eq 'trioz' -or
      $a.InterfaceDescription -match '(?i)AmneziaWG|WireGuard|Wintun|TAP[- ]|Loopback|Hyper-V|VirtualBox') { continue }
  $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $r.InterfaceIndex -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } | Select-Object -First 1
  if (-not $ip) { continue }
  $dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 -InterfaceIndex $r.InterfaceIndex -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty ServerAddresses)
  [pscustomobject]@{ interfaceIndex=[int]$r.InterfaceIndex; interfaceAlias=$a.Name; localAddress=$ip.IPAddress;
    gateway=$r.NextHop; dnsServers=$dns } | ConvertTo-Json -Compress
  break
}`;
  try {
    const text = await ps(script);
    if (!text) return null;
    const r = JSON.parse(text) as PhysicalRoute;
    if (!Number.isInteger(r.interfaceIndex) || r.interfaceIndex <= 0 || !r.interfaceAlias ||
        isIP(r.localAddress) !== 4 || isIP(r.gateway) !== 4) return null;
    r.dnsServers = (Array.isArray(r.dnsServers) ? r.dnsServers : r.dnsServers ? [r.dnsServers] : []).filter((ip) => isIP(ip) === 4);
    return r;
  } catch { return null; }
}

export async function gatewayReady(r: PhysicalRoute): Promise<boolean> {
  const latest = await physicalRoute();
  return !!latest && latest.interfaceIndex === r.interfaceIndex && latest.gateway === r.gateway &&
    latest.localAddress === r.localAddress;
}

/** Gateway ICMP is diagnostic only: many hotspots block ping while forwarding internet. */
export async function gatewayPing(r: PhysicalRoute): Promise<boolean> {
  try {
    const { stdout } = await run('ping.exe', ['-n', '1', '-w', '800', r.gateway], { windowsHide: true, timeout: 3000 });
    return /TTL[=\s]/i.test(stdout);
  } catch { return false; }
}

/** Explicit physical DNS; never resolve a hostname through the full tunnel. IPv6 fails closed. */
export async function resolveEndpoint(endpoint: string, r: PhysicalRoute): Promise<string> {
  const host = endpoint.trim().match(/^\[([^\]]+)\]:(\d+)$/)?.[1] || endpoint.trim().match(/^([^:]+):(\d+)$/)?.[1];
  if (!host) throw new Error('Некорректный VPN endpoint');
  if (isIP(host) === 4) return host;
  if (isIP(host) === 6) throw new Error('IPv6 endpoint пока не поддерживается физическим /32-маршрутом');
  if (!/^[a-z\d.-]+$/i.test(host) || !r.dnsServers.length) throw new Error('Нет физического DNS для VPN endpoint');
  for (const server of r.dnsServers) {
    try {
      const text = await ps(`Resolve-DnsName -Name ${quote(host)} -Type A -Server ${quote(server)} -ErrorAction Stop | Where-Object { $_.Type -eq 'A' } | Select-Object -First 1 -ExpandProperty IPAddress`);
      if (isIP(text) === 4) return text;
    } catch { /* try next DNS server */ }
  }
  throw new Error('Не удалось разрешить VPN endpoint через физический DNS');
}

/** Only edit an exact owned route. Route changes require UAC, never shell interpolation from a profile. */
export async function changeEndpointRoute(old: EndpointRoute | null, next: EndpointRoute | null): Promise<void> {
  for (const route of [old, next]) {
    if (route && (isIP(route.ip) !== 4 || isIP(route.gateway) !== 4 || !Number.isInteger(route.interfaceIndex) || route.interfaceIndex < 1))
      throw new Error('Неверный endpoint route');
  }
  const remove = old ? `$old = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix ${quote(old.ip + '/32')} -InterfaceIndex ${old.interfaceIndex} -NextHop ${quote(old.gateway)} -ErrorAction SilentlyContinue;
if ($old) { $old | Remove-NetRoute -Confirm:$false -ErrorAction Stop }` : '';
  const add = next ? `$physical = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -InterfaceIndex ${next.interfaceIndex} -NextHop ${quote(next.gateway)} -ErrorAction Stop;
if (-not $physical) { throw 'Physical default route changed' }
$existing = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix ${quote(next.ip + '/32')} -ErrorAction SilentlyContinue;
if ($existing) { throw 'Endpoint route already exists; refusing to modify unowned route' }
New-NetRoute -AddressFamily IPv4 -DestinationPrefix ${quote(next.ip + '/32')} -InterfaceIndex ${next.interfaceIndex} -NextHop ${quote(next.gateway)} -RouteMetric 1 -PolicyStore ActiveStore -ErrorAction Stop | Out-Null` : '';
  const script = `$ErrorActionPreference='Stop'; ${remove}\n${add}`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const inner = `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`;
  const outer = `$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ${quote(inner)}; exit $p.ExitCode`;
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], { windowsHide: true, timeout: 120_000 });
  if (next) {
    const result = await ps(`Get-NetRoute -AddressFamily IPv4 -DestinationPrefix ${quote(next.ip + '/32')} -InterfaceIndex ${next.interfaceIndex} -NextHop ${quote(next.gateway)} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty NextHop`);
    if (result !== next.gateway) throw new Error('Endpoint /32 route verification failed (Get-NetRoute)');
  }
}

/** Read all exact /32 routes for an endpoint; never infer from the default tunnel route. */
export async function endpointRoutes(ip: string): Promise<EndpointRoute[]> {
  if (isIP(ip) !== 4) return [];
  try {
    const text = await ps(`@(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix ${quote(ip + '/32')} -ErrorAction SilentlyContinue | Select-Object InterfaceIndex,NextHop) | ConvertTo-Json -Compress`);
    const rows: unknown = JSON.parse(text);
    const list = Array.isArray(rows) ? rows : [rows];
    return list.filter((row): row is { InterfaceIndex: number; NextHop: string } =>
      typeof row === 'object' && row !== null && Number.isInteger((row as { InterfaceIndex: number }).InterfaceIndex) &&
      isIP((row as { NextHop: string }).NextHop) === 4).map((row) =>
      ({ ip, interfaceIndex: row.InterfaceIndex, gateway: row.NextHop }));
  } catch { return []; }
}

/** Independently check that the host route still points to the physical uplink. */
export async function endpointRouteValid(route: EndpointRoute): Promise<boolean> {
  try {
    const hop = await ps(`Get-NetRoute -AddressFamily IPv4 -DestinationPrefix ${quote(route.ip + '/32')} -InterfaceIndex ${route.interfaceIndex} -NextHop ${quote(route.gateway)} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty NextHop`);
    return hop === route.gateway;
  } catch { return false; }
}

/** Actual handshake, not inferred from adapter byte counters. Bundled AmneziaWG supports /dumplog. */
export async function recentAwgHandshake(tool: string, sinceMs = 0): Promise<boolean> {
  try {
    if (/(?:^|[\\/])awg\.exe$/i.test(tool)) {
      const { stdout } = await run(tool, ['show', 'trioz', 'latest-handshakes'], { windowsHide: true, timeout: 10_000 });
      const stamps = stdout.trim().split(/\r?\n/).map((line) => Number(line.trim().split(/\s+/).at(-1)));
      return stamps.some((at) => Number.isFinite(at) && at > 0 && at * 1000 >= sinceMs - 1000 && Math.abs(Date.now() / 1000 - at) < 180);
    }
    // AmneziaWG Windows manager ring log: [TUN] [trioz] ... Received handshake response.
    const { stdout } = await run(tool, ['/dumplog'], { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    return stdout.split(/\r?\n/).some((line) => {
      if (!/\btrioz\b/i.test(line) || !/Received handshake response/i.test(line)) return false;
      const stamp = line.match(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:?\d\d)?/);
      if (!stamp) return false;
      const at = Date.parse(stamp[0].replace(',', '.'));
      return Number.isFinite(at) && at >= sinceMs - 1000 && Math.abs(Date.now() - at) < 180_000;
    });
  } catch { return false; }
}
