<#
.SYNOPSIS
    Shows the running status of Codex Mobile Bridge.
.DESCRIPTION
    Displays service state, port probes (8765 WebSocket, 3000 HTTP), and API health.
#>

$ServiceName = 'CodexMobileBridge'

Write-Host 'Codex Mobile Bridge - Status' -ForegroundColor Cyan
Write-Host ''

# Service status
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    $color = if ($svc.Status -eq 'Running') { 'Green' } else { 'Yellow' }
    Write-Host "  Service: $($svc.Status)" -ForegroundColor $color
} else {
    Write-Host '  Service: NOT INSTALLED' -ForegroundColor Yellow
}

# Port probes
foreach ($probe in @(
    @{ Port = 8765; Name = 'WebSocket' },
    @{ Port = 3000; Name = 'HTTP API' }
)) {
    $tcp = $null
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect('127.0.0.1', $probe.Port)
        Write-Host "  $($probe.Name) (port $($probe.Port)): LISTENING" -ForegroundColor Green
    } catch {
        Write-Host "  $($probe.Name) (port $($probe.Port)): CLOSED" -ForegroundColor Red
    } finally {
        if ($tcp) { $tcp.Dispose() }
    }
}

# HTTP health check
Write-Host ''
try {
    $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/status' -TimeoutSec 3 -ErrorAction Stop
    Write-Host '  API response:' -ForegroundColor Green
    $resp | Format-List
} catch {
    Write-Host '  API: unreachable' -ForegroundColor Red
}
