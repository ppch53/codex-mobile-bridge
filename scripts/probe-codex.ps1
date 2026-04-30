<#
.SYNOPSIS
    Probe Codex app-server connectivity
.DESCRIPTION
    Tests connection to Codex app-server via WebSocket and reports status.
.PARAMETER WsUrl
    WebSocket URL to probe (default: ws://127.0.0.1:4500)
#>
param(
    [string]$WsUrl = "ws://127.0.0.1:4500"
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "=== Codex Mobile Bridge Probe ===" -ForegroundColor Cyan
Write-Host ""

# Check Codex home
$codexHome = "$env:USERPROFILE\.codex"
Write-Host "Codex home: $codexHome"
Write-Host "  Exists: $(Test-Path $codexHome)"

if (Test-Path $codexHome) {
    $sessionsDir = Join-Path $codexHome "sessions"
    if (Test-Path $sessionsDir) {
        $sessionCount = (Get-ChildItem -Path $sessionsDir -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue | Measure-Object).Count
        Write-Host "  Sessions: $sessionCount"
    }

    $stateFiles = Get-ChildItem -Path $codexHome -Filter "state_*.sqlite" -ErrorAction SilentlyContinue
    Write-Host "  State DBs: $($stateFiles.Count)"
}

Write-Host ""

# Check running Codex processes
Write-Host "Running Codex processes:" -ForegroundColor Cyan
$codexProcs = Get-CimInstance Win32_Process | Where-Object { $_.Name -like "*codex*" }
if ($codexProcs) {
    $codexProcs | Select-Object ProcessId, Name, CommandLine | Format-Table -AutoSize
} else {
    Write-Host "  No Codex processes found"
}

Write-Host ""

# Probe common ports
Write-Host "Probing WebSocket ports:" -ForegroundColor Cyan
$ports = @(4500, 9234, 9235, 9236, 9237)
foreach ($port in $ports) {
    try {
        $ready = Invoke-WebRequest "http://127.0.0.1:$port/readyz" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        Write-Host "  Port $port : READY (HTTP $($ready.StatusCode))" -ForegroundColor Green
    } catch {
        Write-Host "  Port $port : not responding" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "Probe complete." -ForegroundColor Cyan
