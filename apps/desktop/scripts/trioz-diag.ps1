# Read-only AmneziaWG / CS2 diagnostics for Windows PowerShell 5.1.
# Start while VPN is connected, then attempt to join a CS2 match.
# No elevation required; unavailable data is recorded as an error.
# No profile, keys, process command lines, packet contents, or external requests.
# Output contains local IP addresses, routes, and process IDs: review before sharing.
param(
    [ValidateRange(5, 300)][int]$Seconds = 60,
    [string]$OutputPath = (Join-Path (Get-Location) 'trioz-cs2-diagnostics.json')
)
$ErrorActionPreference = 'Stop'
function Read-Snapshot([scriptblock]$Query) {
    try { @(& $Query) } catch { @{ unavailable = $_.Exception.Message } }
}
$report = [ordered]@{
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    note = 'Read-only. Interface byte deltas are NOT proof that a CS2 session works.'
    interfaces = Read-Snapshot {
        Get-NetIPInterface | Select-Object InterfaceAlias, InterfaceIndex, AddressFamily, ConnectionState, NlMtu, InterfaceMetric
    }
    adapters = Read-Snapshot {
        Get-NetAdapter | Select-Object Name, InterfaceIndex, Status, InterfaceDescription
    }
    routes = Read-Snapshot {
        Get-NetRoute | Select-Object AddressFamily, DestinationPrefix, NextHop, InterfaceAlias, InterfaceIndex, RouteMetric
    }
    tunnelServices = Read-Snapshot {
        Get-Service | Where-Object { $_.Name -match '^(AmneziaWG|WireGuard)Tunnel\$trioz$' } |
            Select-Object Name, @{ Name = 'Status'; Expression = { $_.Status.ToString() } }
    }
    firewallProfiles = Read-Snapshot {
        Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction
    }
    samples = @()
}
Write-Host "Collecting read-only samples for $Seconds seconds. Attempt to join CS2 now."
$until = (Get-Date).AddSeconds($Seconds)
$samples = [System.Collections.Generic.List[object]]::new()
do {
    $games = @(Get-Process -Name cs2,steam -ErrorAction SilentlyContinue)
    $ids = @($games | Select-Object -ExpandProperty Id)
    $samples.Add([ordered]@{
        at = (Get-Date).ToUniversalTime().ToString('o')
        processes = @($games | Select-Object Id, ProcessName)
        tunnelBytes = Read-Snapshot {
            Get-NetAdapterStatistics -Name trioz | Select-Object Name, ReceivedBytes, SentBytes, ReceivedDiscardedPackets, OutboundDiscardedPackets
        }
        gameUdpBindings = Read-Snapshot {
            Get-NetUDPEndpoint | Where-Object { $ids -contains $_.OwningProcess } |
                Select-Object LocalAddress, LocalPort, OwningProcess
        }
    })
    if ((Get-Date) -lt $until) { Start-Sleep -Seconds 2 }
} while ((Get-Date) -lt $until)
$report.samples = $samples.ToArray()
$report.endedAt = (Get-Date).ToUniversalTime().ToString('o')
$report | ConvertTo-Json -Depth 8 | Out-File -LiteralPath $OutputPath -Encoding UTF8
Write-Host "Saved: $OutputPath"
Write-Host 'Network settings were not changed. Review local addresses before sharing this file.'
