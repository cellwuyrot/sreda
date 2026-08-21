# TrioZ VPN diagnostics. Run in PowerShell as Administrator:
#   powershell -ExecutionPolicy Bypass -File trioz-diag.ps1 > diag.txt
# ASCII-only output on purpose: console code pages mangle everything else.

Write-Output "=== 1. IPv6 stack state (netsh steps fail when it is off) ==="
$reg = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters'
$dc = (Get-ItemProperty -Path $reg -Name DisabledComponents -ErrorAction SilentlyContinue).DisabledComponents
if ($null -eq $dc) { Write-Output 'DisabledComponents: not set (IPv6 enabled)' }
else { Write-Output ("DisabledComponents: 0x{0:X}  (0xFF or 0x20 => IPv6 crippled)" -f $dc) }
Get-NetAdapterBinding -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue |
  Select-Object Name, Enabled | Format-Table -AutoSize | Out-String | Write-Output

Write-Output "=== 2. tunnel adapter ==="
Get-NetAdapter -Name trioz -ErrorAction SilentlyContinue |
  Select-Object Name, Status, InterfaceIndex, MtuSize | Format-Table -AutoSize | Out-String | Write-Output
Get-NetIPAddress -InterfaceAlias trioz -ErrorAction SilentlyContinue |
  Select-Object IPAddress, PrefixLength, AddressFamily | Format-Table -AutoSize | Out-String | Write-Output

Write-Output "=== 3. leftover network devices (must be none when app is off) ==="
Get-PnpDevice -Class Net -ErrorAction SilentlyContinue |
  Where-Object { $_.FriendlyName -match 'Wintun|WireGuard|trioz|Amnezia' } |
  Select-Object Status, FriendlyName, InstanceId | Format-Table -AutoSize | Out-String | Write-Output

Write-Output "=== 4. conflicting services / processes ==="
Get-Service -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'WireGuard|Amnezia|Tunnel' } |
  Select-Object Status, Name, DisplayName | Format-Table -AutoSize | Out-String | Write-Output
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -match 'wireguard|amnezia|wg' } |
  Select-Object Id, ProcessName, Path | Format-Table -AutoSize | Out-String | Write-Output

Write-Output "=== 5. which client binaries are actually shipped ==="
$dir = 'C:\Program Files\TrioZ Connect\resources\wireguard'
if (Test-Path $dir) { Get-ChildItem $dir | Select-Object Name, Length | Format-Table -AutoSize | Out-String | Write-Output }
else { Write-Output "NOT FOUND: $dir" }

Write-Output "=== 6. does the profile ask for obfuscation (AmneziaWG)? ==="
$conf = 'C:\ProgramData\TrioZ\tunnel\tunnel.conf'
if (Test-Path $conf) {
  $keys = Select-String -Path $conf -Pattern '^\s*(Jc|Jmin|Jmax|S[1-4]|H[1-4]|I[1-5])\s*=' -AllMatches
  if ($keys) { Write-Output "profile IS obfuscated -> needs amneziawg-go.exe from step 5" }
  else { Write-Output 'profile is plain WireGuard -> needs wireguard-go.exe' }
} else { Write-Output "no profile on disk (tunnel is down): $conf" }

Write-Output "=== 7. manual netsh probe on the live adapter ==="
Write-Output '--- ipv4 mtu ---'
netsh interface ipv4 set subinterface trioz mtu=1420 store=active
Write-Output "exit=$LASTEXITCODE"
Write-Output '--- ipv6 mtu (this is the step that used to kill the connection) ---'
netsh interface ipv6 set subinterface trioz mtu=1420 store=active
Write-Output "exit=$LASTEXITCODE"
Write-Output '--- ipv4 dns ---'
netsh interface ipv4 set dnsservers name=trioz static 10.8.0.1 primary validate=no
Write-Output "exit=$LASTEXITCODE"

Write-Output "=== 8. endpoint reachability ==="
Resolve-DnsName vpn1.trioz.ru -Type A -ErrorAction SilentlyContinue |
  Select-Object Name, IPAddress | Format-Table -AutoSize | Out-String | Write-Output
Write-Output 'expected: 95.81.126.242'
Test-NetConnection -ComputerName 95.81.126.242 -InformationLevel Quiet -ErrorAction SilentlyContinue | Out-Null
(Invoke-RestMethod 'https://api.ipify.org?format=json' -ErrorAction SilentlyContinue).ip | Write-Output

Write-Output "=== 9. client log tail ==="
$log = Join-Path $env:APPDATA 'trioz-connect\trioz-client.log'
if (Test-Path $log) { Get-Content $log -Tail 40 } else { Write-Output "no log: $log" }
